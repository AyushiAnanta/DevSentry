import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { env } from '../config/env';
import { categoryForRule, mapSemgrepSeverity } from './severityMap';

const execFileAsync = promisify(execFile);
const serverRoot = resolve(__dirname, '../..');
const severityRank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export interface SemgrepRunResult { rawJson: string; warnings: string[] }
export interface SemgrepRunOptions { binary?: string; mode?: 'local' | 'docker'; timeoutMs?: number; maxBuffer?: number; configs?: string[] }
export interface SemgrepFinding { filePath: string; line: number; endLine: number; ruleId: string; ruleIds: string[]; source: 'semgrep'; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; category: string; message: string }
interface RawSemgrepResult { check_id?: unknown; path?: unknown; start?: unknown; end?: unknown; extra?: unknown }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function resolveConfig(config: string): string { return config.startsWith('p/') || config.startsWith('r/') ? config : isAbsolute(config) ? config : resolve(serverRoot, config); }
function containerConfig(config: string): string { return config.startsWith('p/') || config.startsWith('r/') ? config : `/devsentry-server/${relative(serverRoot, resolveConfig(config)).split(sep).join('/')}`; }
function argsFor(configs: string[], files: string[], root: string, container: boolean): string[] {
  const configArgs = configs.flatMap(config => ['--config', container ? containerConfig(config) : resolveConfig(config)]);
  const fileArgs = container ? files.map(file => `/src/${relative(root, file).split(sep).join('/')}`) : files;
  return ['scan', '--json', '--metrics=off', '--no-git-ignore', ...configArgs, ...fileArgs];
}
function invocation(mode: 'local' | 'docker', binary: string, configs: string[], files: string[], root: string): { binary: string; args: string[] } {
  if (mode === 'local') return { binary, args: argsFor(configs, files, root, false) };
  const rootMount = `${root}:/src:ro`;
  const configMount = `${serverRoot}:/devsentry-server:ro`;
  return { binary: 'docker', args: ['run', '--rm', '-v', rootMount, '-v', configMount, '--workdir', '/src', 'semgrep/semgrep:1.185.0', 'semgrep', ...argsFor(configs, files, root, true)] };
}
function pathFromSemgrep(rawPath: string, root: string): string | null {
  const normalizedRoot = resolve(root);
  let candidate = rawPath.replace(/\\/g, '/');
  if (candidate.startsWith('/src/')) candidate = candidate.slice('/src/'.length);
  else if (isAbsolute(rawPath)) {
    const rel = relative(normalizedRoot, resolve(rawPath));
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    candidate = rel.split(sep).join('/');
  }
  candidate = candidate.replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!candidate || candidate === '..' || candidate.startsWith('../') || candidate.includes(':')) return null;
  return candidate;
}
export function parseSemgrepJson(rawJson: string, root: string): SemgrepFinding[] {
  const parsed: unknown = JSON.parse(rawJson);
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) throw new Error('Semgrep output did not contain a results array.');
  const byLocation = new Map<string, SemgrepFinding>();
  for (const rawResult of parsed.results) {
    if (!isRecord(rawResult)) continue;
    const result = rawResult as RawSemgrepResult;
    const extra = isRecord(result.extra) ? result.extra : {};
    const start = isRecord(result.start) ? result.start : {};
    const end = isRecord(result.end) ? result.end : {};
    if (typeof result.check_id !== 'string' || typeof result.path !== 'string' || typeof start.line !== 'number') continue;
    const filePath = pathFromSemgrep(result.path, root);
    if (!filePath || !Number.isInteger(start.line) || start.line < 1) continue;
    const ruleId = result.check_id.replace(/^(?:devsentry-server\.)?semgrep-rules\./, '');
    const severity = mapSemgrepSeverity(typeof extra.severity === 'string' ? extra.severity : 'INFO', ruleId);
    const candidate: SemgrepFinding = { filePath, line: start.line, endLine: typeof end.line === 'number' ? end.line : start.line, ruleId, ruleIds: [ruleId], source: 'semgrep', severity, category: categoryForRule(ruleId), message: typeof extra.message === 'string' ? extra.message : ruleId };
    const key = `${filePath}:${start.line}`;
    const current = byLocation.get(key);
    if (!current) { byLocation.set(key, candidate); continue; }
    const ruleIds = [...new Set([...current.ruleIds, ruleId])].sort();
    const winner = (severityRank[severity] ?? 0) > (severityRank[current.severity] ?? 0) ? candidate : current;
    byLocation.set(key, { ...winner, ruleId: winner.ruleId, ruleIds });
  }
  return [...byLocation.values()].sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
}
export async function runSemgrep(files: string[], root: string, options: SemgrepRunOptions = {}): Promise<SemgrepRunResult> {
  if (files.length === 0) return { rawJson: JSON.stringify({ results: [] }), warnings: [] };
  const configs = options.configs ?? env.SEMGREP_CONFIGS.split(',').map(config => config.trim()).filter(Boolean);
  const localConfigs = configs.filter(config => !config.startsWith('p/') && !config.startsWith('r/'));
  const binary = options.binary ?? env.SEMGREP_BIN; const mode = options.mode ?? env.SEMGREP_MODE;
  const timeout = options.timeoutMs ?? env.SCAN_TIMEOUT_MS; const maxBuffer = options.maxBuffer ?? 50 * 1024 * 1024; const warnings: string[] = [];
  const execute = async (activeConfigs: string[]): Promise<string> => {
    const command = invocation(mode, binary, activeConfigs, files, root);
    const result = await execFileAsync(command.binary, command.args, { cwd: root, timeout, maxBuffer, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return result.stdout;
  };
  try { return { rawJson: await execute(configs), warnings }; }
  catch (error) {
    const code = isRecord(error) && 'code' in error ? error.code : undefined;
    if (code === 'ETIMEDOUT') throw new Error('Semgrep analysis exceeded its time limit.');
    if (localConfigs.length > 0 && configs.length > localConfigs.length) {
      warnings.push('Semgrep registry packs were unavailable; scan continued with local rules only.');
      try { return { rawJson: await execute(localConfigs), warnings }; } catch { /* Report a sanitized tool error below. */ }
    }
    throw new Error('Semgrep analysis failed.');
  }
}
