import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { FileRisk } from '../src/models/FileRisk';
import { Finding } from '../src/models/Finding';
import { Project } from '../src/models/Project';
import { Scan } from '../src/models/Scan';
import { User } from '../src/models/User';
import * as scanService from '../src/services/scanService';
import { runLizard } from '../src/services/metricsService';
import { HistoryResult } from '../src/services/gitHistoryService';
import { removeTempDir } from '../src/services/repoService';
import { runSemgrep } from '../src/services/semgrepService';
import { markInterruptedScansFailed } from '../src/services/scanRecoveryService';

const execFileAsync = promisify(execFile);
const fixtures = resolve(__dirname, 'fixtures');
const candidateLizardScript = process.env.DEVSENTRY_LIZARD_SCRIPT ?? join(tmpdir(), 'devsentry-lizard', 'lizard.py');
const lizardBinary = process.env.DEVSENTRY_LIZARD_BIN ?? (existsSync(candidateLizardScript) ? candidateLizardScript : env.LIZARD_BIN);
const lizardReady = lizardBinary.toLowerCase().endsWith('.py') ? existsSync(lizardBinary) : spawnSync(lizardBinary, ['--version'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }).status === 0;
const semgrepReady = spawnSync('docker', ['run', '--rm', 'semgrep/semgrep', 'semgrep', '--version'], { windowsHide: true, stdio: 'ignore', timeout: 30000 }).status === 0;
const missingRealTools = [!semgrepReady ? 'Docker Semgrep unavailable' : '', !lizardReady ? 'Lizard unavailable' : ''].filter(Boolean);
if (missingRealTools.length) process.stderr.write(`SKIPPED real pipeline test: ${missingRealTools.join('; ')}.\n`);
const realPipelineTest = missingRealTools.length ? test.skip : test;
let mongo: MongoMemoryServer;
let repoPath = '';
let ownerId = new Types.ObjectId();
let projectId = new Types.ObjectId();

async function git(args: string[], author: string, when: string): Promise<void> {
  await execFileAsync('git', args, { cwd: repoPath, windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author, GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@fixture.test`, GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@fixture.test`, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
}
async function makeFixtureRepo(): Promise<string> {
  const destination = await fs.mkdtemp(join(tmpdir(), 'devsentry-pipeline-source-'));
  repoPath = destination;
  await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: repoPath, windowsHide: true });
  await execFileAsync('git', ['config', 'core.hooksPath', 'NUL'], { cwd: repoPath, windowsHide: true });
  await fs.copyFile(join(fixtures, 'buggy.ts'), join(repoPath, 'buggy.ts'));
  await fs.copyFile(join(fixtures, 'buggy.py'), join(repoPath, 'buggy.py'));
  await fs.copyFile(join(fixtures, 'Buggy.java'), join(repoPath, 'Buggy.java'));
  const first = '2026-11-18T12:00:00Z';
  await git(['add', 'buggy.ts', 'buggy.py', 'Buggy.java'], 'Ada', first);
  await git(['commit', '-m', 'feat: fixture baseline'], 'Ada', first);
  await fs.appendFile(join(repoPath, 'buggy.ts'), '\n// local repository history entry\n');
  await git(['add', 'buggy.ts'], 'Bob', '2026-11-19T12:00:00Z');
  await git(['commit', '-m', 'fix: null check'], 'Bob', '2026-11-19T12:00:00Z');
  await fs.appendFile(join(repoPath, 'buggy.py'), '\n# local repository history entry\n');
  await git(['add', 'buggy.py'], 'Ada', '2026-11-20T12:00:00Z');
  await git(['commit', '-m', 'docs: fixture update'], 'Ada', '2026-11-20T12:00:00Z');
  return destination;
}
async function createScan(): Promise<mongoose.Document & { _id: Types.ObjectId }> {
  const project = await Project.create({ _id: projectId, owner: ownerId, name: 'fixture', source: { type: 'github', url: 'https://github.com/acme/fixture' } });
  const scan = await Scan.create({ project: project._id, owner: ownerId, status: 'queued', warnings: [] });
  return scan as mongoose.Document & { _id: Types.ObjectId };
}
function emptyHistory(): HistoryResult { return { files: new Map(), warnings: [], commits: [] }; }
function pipelineDependencies(destination: string) {
  return {
    clone: async (_url: string, target: string): Promise<void> => { await fs.cp(destination, target, { recursive: true }); },
    sizeCheck: async (): Promise<void> => undefined,
    lizard: (files: string[], root: string, options: Parameters<typeof runLizard>[2] = {}) => runLizard(files, root, { ...options, binary: lizardBinary }),
    semgrep: (files: string[], root: string, options: Parameters<typeof runSemgrep>[2] = {}) => runSemgrep(files, root, { ...options, mode: 'docker' }),
  };
}
function responseBody(raw: string): { statusLine: string; body: string } {
  const divider = raw.indexOf('\r\n\r\n');
  if (divider < 0) throw new Error('curl did not return an HTTP response.');
  return { statusLine: raw.slice(0, divider).split('\r\n')[0] ?? '', body: raw.slice(divider + 4).trim() };
}
async function curl(url: string, token: string): Promise<{ statusLine: string; body: string }> {
  const { stdout } = await execFileAsync('curl.exe', ['-sS', '-i', url, '-H', `Cookie: token=${token}`], { windowsHide: true, timeout: 30000, encoding: 'utf8' });
  return responseBody(stdout);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await makeFixtureRepo();
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  if (repoPath) await removeTempDir(repoPath);
});
beforeEach(async () => {
  ownerId = new Types.ObjectId();
  projectId = new Types.ObjectId();
  await Promise.all([Project.deleteMany({}), Scan.deleteMany({}), Finding.deleteMany({}), FileRisk.deleteMany({})]);
});

describe('scan pipeline', () => {
  realPipelineTest('scans three real fixtures through curl, persists results, and removes its clone directory', async () => {
    const scanServiceStart = scanService.startProjectScan;
    const cloneDestinations: string[] = [];
    const dependencies = pipelineDependencies(repoPath);
    const hookedDependencies = { ...dependencies, clone: async (url: string, target: string) => { cloneDestinations.push(target); await dependencies.clone(url, target); } };
    const appServer = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolveListening => appServer.once('listening', resolveListening));
    const address = appServer.address();
    if (!address || typeof address === 'string') throw new Error('Test API failed to bind a port.');
    const project = await Project.create({ _id: projectId, owner: ownerId, name: 'Fixture repo', source: { type: 'github', url: 'https://github.com/acme/fixture' } });
    await User.create({ _id: ownerId, googleId: ownerId.toString(), email: 'scan-demo@example.test', name: 'Scan Demo' });
    const token = jwt.sign({ id: ownerId.toString() }, env.JWT_SECRET, { expiresIn: '7d' });
    const spy = jest.spyOn(scanService, 'startProjectScan').mockImplementation((id, owner) => scanServiceStart(id, owner, hookedDependencies));
    const base = `http://127.0.0.1:${address.port}/api`;
    try {
      process.stdout.write(`CURL_DEMO_JWT=jwt.sign({ id: "${ownerId.toString()}" }, env.JWT_SECRET, { expiresIn: "7d" })\n`);
      process.stdout.write(`CURL_DEMO_TOKEN=${token}\n`);
      process.stdout.write(`curl.exe -i -X POST "${base}/projects/${project.id}/scans" -H "Cookie: token=${token}"\n`);
      const create = await execFileAsync('curl.exe', ['-sS', '-i', '-X', 'POST', `${base}/projects/${project.id}/scans`, '-H', `Cookie: token=${token}`], { windowsHide: true, timeout: 30000, encoding: 'utf8' });
      const created = responseBody(create.stdout);
      expect(created.statusLine).toMatch(/202/);
      const accepted = JSON.parse(created.body) as { scanId: string; status: string };
      expect(accepted.status).toBe('queued');
      process.stdout.write(`CURL_CREATE_HTTP=${created.statusLine}\nCURL_CREATE_RESPONSE=${created.body}\n`);
      process.stdout.write(`curl.exe -i "${base}/scans/${accepted.scanId}" -H "Cookie: token=${token}"  # poll until status=done\n`);
      const concurrent = await execFileAsync('curl.exe', ['-sS', '-i', '-X', 'POST', `${base}/projects/${project.id}/scans`, '-H', `Cookie: token=${token}`], { windowsHide: true, timeout: 30000, encoding: 'utf8' });
      expect(responseBody(concurrent.stdout).statusLine).toMatch(/409/);
      let status = await curl(`${base}/scans/${accepted.scanId}`, token);
      for (let attempt = 0; attempt < 120 && ['queued', 'running'].includes((JSON.parse(status.body) as { status: string }).status); attempt++) {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
        status = await curl(`${base}/scans/${accepted.scanId}`, token);
      }
      expect(status.statusLine).toMatch(/200/);
      expect((JSON.parse(status.body) as { status: string }).status).toBe('done');
      process.stdout.write(`curl.exe -i "${base}/scans/${accepted.scanId}/findings?page=1&limit=100" -H "Cookie: token=${token}"\n`);
      process.stdout.write(`curl.exe -i "${base}/scans/${accepted.scanId}/files?page=1&limit=100" -H "Cookie: token=${token}"\n`);
      const findingResponse = await curl(`${base}/scans/${accepted.scanId}/findings?page=1&limit=100`, token);
      const fileResponse = await curl(`${base}/scans/${accepted.scanId}/files?page=1&limit=100`, token);
      const findings = JSON.parse(findingResponse.body) as { items: Array<Record<string, unknown>>; total: number };
      const files = JSON.parse(fileResponse.body) as { items: Array<Record<string, unknown>>; total: number };
      expect(findings.total).toBeGreaterThan(0);
      expect(files.total).toBe(3);
      const deduped = findings.items.find(item => item.filePath === 'buggy.py' && item.line === 14);
      expect(deduped?.ruleIds).toEqual(expect.arrayContaining(['python.lang.security.audit.eval-detected.eval-detected', 'devsentry.dynamic-eval-python']));
      const responseText = JSON.stringify([created.body, status.body, findingResponse.body, fileResponse.body]);
      expect(responseText).not.toContain('/src/');
      expect(responseText).not.toContain('/devsentry-server/');
      expect(responseText).not.toMatch(/\/tmp\/|\\temp\\/i);
      expect(responseText.toLowerCase()).not.toContain('devsentry-pipeline-source-');
      for (const destination of cloneDestinations) await expect(fs.access(destination)).rejects.toThrow();
      process.stdout.write(`CURL_STATUS_HTTP=${status.statusLine}\nCURL_STATUS_RESPONSE=${status.body}\n`);
      process.stdout.write(`CURL_FINDINGS_JSON=${JSON.stringify(findings.items, null, 2)}\n`);
      process.stdout.write(`CURL_FILERISK_JSON=${JSON.stringify(files.items, null, 2)}\n`);
    } finally {
      spy.mockRestore();
      await new Promise<void>(resolveClose => appServer.close(() => resolveClose()));
    }
  }, 240000);

  test('marks a failed analysis with a sanitized error and removes its temp clone', async () => {
    const scan = await createScan();
    let cloneDirectory = '';
    await scanService.runScanPipeline(String(scan._id), {
      clone: async (_url, destination) => { cloneDirectory = destination; await fs.cp(repoPath, destination, { recursive: true }); },
      sizeCheck: async () => undefined,
      lizard: async () => { throw new Error(`tool failed in ${cloneDirectory}`); },
      semgrep: async () => ({ rawJson: '{"results":[]}', warnings: [] }),
      history: async () => emptyHistory(),
    });
    const failed = await Scan.findById(scan._id).lean();
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('Scan failed during analysis.');
    expect(failed?.error).not.toContain(cloneDirectory);
    await expect(fs.access(cloneDirectory)).rejects.toThrow();
  });

  test('enforces the whole-scan timeout and removes its temp clone', async () => {
    const scan = await createScan();
    let cloneDirectory = '';
    await scanService.runScanPipeline(String(scan._id), {
      timeoutMs: 500,
      clone: async (_url, destination) => { cloneDirectory = destination; await fs.cp(repoPath, destination, { recursive: true }); },
      sizeCheck: async () => undefined,
      lizard: async () => new Promise(() => undefined),
      semgrep: async () => ({ rawJson: '{"results":[]}', warnings: [] }),
      history: async () => emptyHistory(),
    });
    expect((await Scan.findById(scan._id).lean())?.error).toBe('Scan exceeded its time limit.');
    await expect(fs.access(cloneDirectory)).rejects.toThrow();
  });

  test('marks queued and running scans failed after restart recovery', async () => {
    const project = await Project.create({ _id: projectId, owner: ownerId, name: 'recovery', source: { type: 'github', url: 'https://github.com/acme/recovery' } });
    const scans = await Scan.insertMany([{ project: project._id, owner: ownerId, status: 'queued' }, { project: project._id, owner: ownerId, status: 'running', stage: 'analyzing' }, { project: project._id, owner: ownerId, status: 'done' }]);
    expect(await markInterruptedScansFailed()).toBe(2);
    const recovered = await Scan.find({ _id: { $in: scans.map(scan => scan._id) } }).sort({ status: 1 }).lean();
    expect(recovered.filter(scan => scan.status === 'failed')).toHaveLength(2);
    expect(recovered.filter(scan => scan.status === 'failed').every(scan => scan.error === 'interrupted by restart' && scan.stage === null)).toBe(true);
    expect(recovered.some(scan => scan.status === 'done')).toBe(true);
  });
});
