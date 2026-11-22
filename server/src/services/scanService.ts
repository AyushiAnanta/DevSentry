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

export interface ScanDependencies {
  clone?: CloneImplementation;
  sizeCheck?: typeof checkGithubSize;
  lizard?: typeof runLizard;
  semgrep?: typeof runSemgrep;
  history?: typeof getGitHistory;
  timeoutMs?: number;
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
export async function runScanPipeline(scanId: string, dependencies: ScanDependencies = {}): Promise<void> {
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
    root = await within(cloneRepo(repo, dependencies.clone, remaining(deadline)), remaining(deadline));
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
    const findings = normalizedFindings(semgrepFindings, lizardFindings);
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
    const summary = summarizeRisk(fileRisks.map(file => file.riskScore), findingCounts(findings));
    await Scan.updateOne({ _id: scan._id }, { $set: { stage: 'saving', warnings } });
    await within(Promise.all([
      findings.length ? Finding.insertMany(findings.map(finding => ({ ...finding, scan: scan._id, owner: scan.owner })), { ordered: true }) : Promise.resolve([]),
      fileRisks.length ? FileRisk.insertMany(fileRisks, { ordered: true }) : Promise.resolve([]),
    ]), remaining(deadline));
    await Scan.updateOne({ _id: scan._id }, { $set: { status: 'done', stage: null, warnings, summary, finishedAt: new Date() } });
  } catch (error) {
    await Scan.updateOne({ _id: scan._id }, { $set: { status: 'failed', stage: null, warnings, error: safeFailureMessage(error), finishedAt: new Date() } });
  } finally {
    if (root) await removeTempDir(root);
  }
}
