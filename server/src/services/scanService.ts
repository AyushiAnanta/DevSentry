import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { env } from '../config/env';
import { FileRisk, FileRiskRecord } from '../models/FileRisk';
import { Finding, FindingRecord } from '../models/Finding';
import { Project } from '../models/Project';
import { Scan } from '../models/Scan';
import { checkGithubSize, cloneRepo, CloneImplementation, listSourceFiles, parseGithubUrl, removeTempDir, SourceFile } from './repoService';
import { runLizard, findingsFromLizard, LizardFileMetrics } from './metricsService';
import { getGitHistory, HistoryResult } from './gitHistoryService';
import { parseSemgrepJson, runSemgrep, SemgrepFinding } from './semgrepService';
import { scoreFile, SeverityCounts, summarizeRisk } from './riskScoringService';
import { enqueueScan, isScanActiveForOwner } from './scanQueue';
import { aiConfigured, aiService, AIProvider, redactSecretLiterals, redactSensitiveLineLiterals, withAICallBudget } from './ai/aiService';
import { FileSource } from '../models/FileSource';

export interface ScanDependencies {
  clone?: CloneImplementation;
  sizeCheck?: typeof checkGithubSize;
  lizard?: typeof runLizard;
  semgrep?: typeof runSemgrep;
  history?: typeof getGitHistory;
  timeoutMs?: number;
  ai?: AIProvider;
}
export type StartScanResult = { kind: 'started'; scanId: string } | { kind: 'not-found' } | { kind: 'conflict' };
const severityValues = ['critical', 'high', 'medium', 'low', 'info'] as const;
function emptyCounts(): SeverityCounts { return { critical: 0, high: 0, medium: 0, low: 0, info: 0 }; }
function remaining(deadline: number): number { const value = deadline - Date.now(); if (value <= 0) throw new Error('Scan timed out.'); return value; }
function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('Scan timed out.')), Math.max(timeoutMs, 1));
    void promise.then(value => { clearTimeout(timer); resolvePromise(value); }, error => { clearTimeout(timer); rejectPromise(error); });
  });
}
async function repositoryBytes(root: string, deadline: number): Promise<number> {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    remaining(deadline);
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) total += (await fs.stat(path)).size;
    }
  }
  return total;
}
function languageFor(file: SourceFile): string { return file.language; }
function safeFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'Scan timed out.') return 'Scan exceeded its time limit.';
  if (error instanceof Error && error.message.startsWith('Repository exceeds')) return error.message;
  if (error instanceof Error && /Semgrep analysis/.test(error.message)) return error.message;
  if (error instanceof Error && /Lizard analysis/.test(error.message)) return error.message;
  return 'Scan failed during analysis.';
}
function findingCounts(findings: Array<{ severity: string }>): SeverityCounts {
  const counts = emptyCounts();
  for (const finding of findings) if (severityValues.includes(finding.severity as typeof severityValues[number])) counts[finding.severity as keyof SeverityCounts]++;
  return counts;
}
function normalizedFindings(semgrep: SemgrepFinding[], lizard: ReturnType<typeof findingsFromLizard>): Array<Omit<FindingRecord, 'scan' | 'owner'>> {
  const merged: Array<Omit<FindingRecord, 'scan' | 'owner'>> = [
    ...semgrep.map(finding => ({ filePath: finding.filePath, line: finding.line, endLine: finding.endLine, ruleId: finding.ruleId, ruleIds: finding.ruleIds, source: finding.source, severity: finding.severity, category: finding.category, message: finding.message, riskScore: 0 })),
    ...lizard.map(finding => ({ filePath: finding.filePath, line: finding.line, endLine: finding.endLine, ruleId: finding.ruleId, ruleIds: [finding.ruleId], source: finding.source, severity: finding.severity, category: finding.category, message: finding.message, riskScore: 0 })),
  ];
  return merged;
}
const severityRank:Record<string,number>={critical:5,high:4,medium:3,low:2,info:1};
export function dedupeFindings<T extends {filePath:string;line:number;ruleId:string;ruleIds?:string[];severity:string}>(findings:T[]):T[]{
  const byLocation=new Map<string,T>();
  for(const finding of findings){
    const key=`${finding.filePath}:${finding.line}`;
    const current=byLocation.get(key);
    if(!current){byLocation.set(key,finding);continue;}
    const ruleIds=[...new Set([...(current.ruleIds??[current.ruleId]),...(finding.ruleIds??[finding.ruleId])])].sort();
    const winner=(severityRank[finding.severity]??0)>(severityRank[current.severity]??0)?finding:current;
    byLocation.set(key,{...winner,ruleIds} as T);
  }
  return [...byLocation.values()].sort((a,b)=>a.filePath.localeCompare(b.filePath)||a.line-b.line);
}
export async function startProjectScan(projectId: string, ownerId: string, dependencies: ScanDependencies = {}): Promise<StartScanResult> {
  if (isScanActiveForOwner(ownerId)) return { kind: 'conflict' };
  const project = await Project.findOne({ _id: projectId, owner: ownerId });
  if (!project) return { kind: 'not-found' };
  const scan = await Scan.create({ project: project._id, owner: ownerId, status: 'queued', stage: null, warnings: [] });
  const enqueued = enqueueScan(ownerId, () => runScanPipeline(String(scan._id), dependencies));
  if (!enqueued) {
    await Scan.deleteOne({ _id: scan._id, owner: ownerId });
    return { kind: 'conflict' };
  }
  return { kind: 'started', scanId: String(scan._id) };
}
export function runScanPipeline(scanId:string,dependencies:ScanDependencies={}):Promise<void>{return withAICallBudget(env.AI_MAX_CALLS,()=>runScanPipelineTask(scanId,dependencies));}
async function runScanPipelineTask(scanId: string, dependencies: ScanDependencies = {}): Promise<void> {
  const scan = await Scan.findById(scanId);
  if (!scan) return;
  const deadline = Date.now() + (dependencies.timeoutMs ?? env.SCAN_TIMEOUT_MS);
  let root: string | null = null;
  const warnings: string[] = [];
  try {
    const project = await Project.findOne({ _id: scan.project, owner: scan.owner });
    if (!project) throw new Error('Project unavailable.');
    const repo = parseGithubUrl(project.source.url);
    await Scan.updateOne({ _id: scan._id }, { $set: { status: 'running', stage: 'cloning', startedAt: new Date(), error: undefined } });
    await within((dependencies.sizeCheck ?? checkGithubSize)(repo, { warnings }), remaining(deadline));
    root = await within(cloneRepo(repo, dependencies.clone, remaining(deadline), directory => { root = directory; }), remaining(deadline));
    const bytes = await within(repositoryBytes(root, deadline), remaining(deadline));
    if (bytes > env.MAX_REPO_SIZE_MB * 1024 * 1024) throw new Error(`Repository exceeds the ${env.MAX_REPO_SIZE_MB} MB size limit`);
    const sourceFiles = await within(listSourceFiles(root, { warnings }), remaining(deadline));
    await Scan.updateOne({ _id: scan._id }, { $set: { stage: 'analyzing' } });
    const toolTimeout = remaining(deadline);
    const [lizardMetrics, semgrepRun, history] = await within(Promise.all([
      (dependencies.lizard ?? runLizard)(sourceFiles.map(file => file.absolutePath), root, { timeoutMs: toolTimeout }),
      (dependencies.semgrep ?? runSemgrep)(sourceFiles.map(file => file.absolutePath), root, { timeoutMs: toolTimeout }),
      (dependencies.history ?? getGitHistory)(root, { timeoutMs: toolTimeout }),
    ]), toolTimeout) as [LizardFileMetrics[], Awaited<ReturnType<typeof runSemgrep>>, HistoryResult];
    warnings.push(...semgrepRun.warnings, ...history.warnings);
    const semgrepFindings = parseSemgrepJson(semgrepRun.rawJson, root);
    const lizardFindings = findingsFromLizard(lizardMetrics);
    let findings = normalizedFindings(semgrepFindings, lizardFindings);
    const metricsByFile = new Map(lizardMetrics.map(value => [value.filePath, value]));
    const findingsByFile = new Map<string, typeof findings>();
    for (const finding of findings) {
      const rows = findingsByFile.get(finding.filePath) ?? [];
      rows.push(finding);
      findingsByFile.set(finding.filePath, rows);
    }
    await Scan.updateOne({ _id: scan._id }, { $set: { stage: 'scoring', warnings } });
    const fileRisks: FileRiskRecord[] = sourceFiles.map(file => {
      const metrics = metricsByFile.get(file.filePath);
      const fileHistory = history.files.get(file.filePath);
      const fileFindings = findingsByFile.get(file.filePath) ?? [];
      const counts = findingCounts(fileFindings);
      const nloc = metrics?.nloc ?? 0;
      const score = scoreFile({ nloc, maxCcn: metrics?.maxCcn ?? 0, commits90d: fileHistory?.commits90d ?? 0, bugFixCommits: fileHistory?.bugFixCommits ?? 0, authors: fileHistory?.authors ?? 0, findingCounts: counts });
      for (const finding of fileFindings) finding.riskScore = score.riskScore;
      return { scan: scan._id, owner: scan.owner, filePath: file.filePath, language: languageFor(file), riskScore: score.riskScore, factors: score.factors, metrics: { nloc, maxCcn: metrics?.maxCcn ?? 0, avgCcn: metrics?.avgCcn ?? 0, functionCount: metrics?.functionCount ?? 0, maxParams: metrics?.maxParams ?? 0, commits90d: fileHistory?.commits90d ?? 0, authors: fileHistory?.authors ?? 0, bugFixCommits: fileHistory?.bugFixCommits ?? 0, findingCounts: counts } };
    });
    let summary = summarizeRisk(fileRisks.map(file => file.riskScore), findingCounts(findings));
    const fileRiskByPath = new Map(fileRisks.map(file => [file.filePath,file.riskScore]));
    let aiStatus: 'skipped'|'partial'|'complete' = 'skipped';
    const provider = dependencies.ai ?? aiService;
    const available = dependencies.ai !== undefined || aiConfigured();
    if (available && env.AI_MAX_CALLS > 0) {
      let calls = 0;
      let failures = false;
      const selected = [...findings].sort((a,b) => severityValues.indexOf(a.severity as typeof severityValues[number])-severityValues.indexOf(b.severity as typeof severityValues[number]) || (fileRiskByPath.get(b.filePath)??0)-(fileRiskByPath.get(a.filePath)??0)).slice(0,env.AI_MAX_FINDINGS);
      for (const finding of selected) {
        if (calls >= env.AI_MAX_CALLS) { failures = true; break; }
        const file = sourceFiles.find(candidate => candidate.filePath === finding.filePath);
        if (!file) continue;
        try {
          const content = await fs.readFile(file.absolutePath,'utf8');
          const lines = content.split(/\r?\n/);
          const start = Math.max(0,finding.line-11), end = Math.min(lines.length,finding.line+10);
          let snippet = lines.slice(start,end).map((line,index)=>`${start+index+1}: ${line}`).join('\n');
          snippet = /secret|password/i.test(`${finding.ruleId} ${finding.category} ${finding.message}`) ? redactSecretLiterals(snippet) : redactSensitiveLineLiterals(snippet);
          calls++;
          const [result] = await within(provider.explainFindings([{ruleId:finding.ruleId,severity:finding.severity,message:finding.message,filePath:finding.filePath,line:finding.line,snippet}]),remaining(deadline));
          if (result) { finding.explanation = result.explanation; finding.suggestion = result.suggestion; finding.aiGenerated = true; finding.snippet = snippet; }
          else failures = true;
        } catch { failures = true; }
      }
      if (env.AI_REVIEW_FILES) {
        const riskSorted = [...sourceFiles].sort((a,b)=>(fileRiskByPath.get(b.filePath)??0)-(fileRiskByPath.get(a.filePath)??0)).slice(0,env.AI_REVIEW_TOP_FILES);
        for (const file of riskSorted) {
          if (calls >= env.AI_MAX_CALLS) { failures = true; break; }
          try {
            const content = await fs.readFile(file.absolutePath,'utf8'); calls++;
            const reviewed = await within(provider.reviewFile({filePath:file.filePath,content:redactSensitiveLineLiterals(content).slice(0,200*1024)}),remaining(deadline));
            const lineCount = content.split(/\r?\n/).length;
            for (const item of reviewed) if (item.line <= lineCount) findings.push({filePath:file.filePath,line:item.line,endLine:item.line,ruleId:'llm.logic-review',ruleIds:['llm.logic-review'],source:'llm',severity:item.severity,category:'bug',message:item.message,confidence:item.confidence,riskScore:fileRiskByPath.get(file.filePath)??0});
          } catch { failures = true; }
        }
      }
      aiStatus = calls === 0 ? 'skipped' : failures ? 'partial' : 'complete';
      if (calls === 0) warnings.push('AI analysis skipped because there were no eligible findings or files.');
      if (failures) warnings.push('Some AI analysis was skipped or unavailable.');
    } else if (!available) { aiStatus='skipped'; warnings.push('AI analysis skipped because no provider key is configured.'); }
    else if (env.AI_MAX_CALLS === 0 || (env.AI_MAX_FINDINGS === 0 && !env.AI_REVIEW_FILES)) { aiStatus='skipped'; warnings.push('AI analysis skipped because the configured call limit is zero.'); }
    findings=dedupeFindings(findings);
    summary = summarizeRisk(fileRisks.map(file => file.riskScore), findingCounts(findings));
    const storedFiles = [...sourceFiles].sort((a,b)=>(fileRiskByPath.get(b.filePath)??0)-(fileRiskByPath.get(a.filePath)??0)).slice(0,20);
    const fileSources = await Promise.all(storedFiles.map(async file => ({scan:scan._id,owner:scan.owner,filePath:file.filePath,content:(await fs.readFile(file.absolutePath)).subarray(0,200*1024).toString('utf8')})));
    await Scan.updateOne({ _id: scan._id }, { $set: { stage: 'saving', warnings } });
    await within(Promise.all([
      findings.length ? Finding.insertMany(findings.map(finding => ({ ...finding, scan: scan._id, owner: scan.owner })), { ordered: true }) : Promise.resolve([]),
      fileRisks.length ? FileRisk.insertMany(fileRisks, { ordered: true }) : Promise.resolve([]),
      fileSources.length ? FileSource.insertMany(fileSources, { ordered: true }) : Promise.resolve([]),
    ]), remaining(deadline));
    await Scan.updateOne({ _id: scan._id }, { $set: { status: 'done', stage: null, warnings, summary, aiStatus, finishedAt: new Date() } });
  } catch (error) {
    await Scan.updateOne({ _id: scan._id }, { $set: { status: 'failed', stage: null, warnings, error: safeFailureMessage(error), finishedAt: new Date() } });
  } finally {
    if (root) await removeTempDir(root);
  }
}
