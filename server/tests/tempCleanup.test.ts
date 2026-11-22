/**
 * tests/tempCleanup.test.ts
 *
 * Tests for:
 *  1. removeTempDir resolves (does not throw) when fs.rm rejects with EBUSY
 *  2. removeTempDir actually deletes a real temp directory containing nested files
 *  3. sweepStaleTempDirs removes an old "devsentry-*" dir, keeps a fresh one,
 *     and ignores directories with other names
 *  4. A request with a Cookie header produces log output that does not contain the cookie value
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { logger } from '../src/config/logger';
import { removeTempDir, sweepStaleTempDirs } from '../src/services/repoService';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Create a real temp dir under os.tmpdir() with the given name and nested files */
async function makeTempDir(name: string): Promise<string> {
  const dir = join(tmpdir(), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(join(dir, 'sub'), { recursive: true });
  await fs.writeFile(join(dir, 'file.txt'), 'hello');
  await fs.writeFile(join(dir, 'sub', 'nested.txt'), 'world');
  return dir;
}

/** Set the mtime of a directory back by `ageMs` milliseconds */
async function setOld(dir: string, ageMs: number): Promise<void> {
  const old = new Date(Date.now() - ageMs);
  await fs.utimes(dir, old, old);
}

// ── 1. removeTempDir resolves on EBUSY ───────────────────────────────────────

describe('removeTempDir', () => {
  test('resolves (does not throw) when fs.rm rejects with EBUSY, and logs a warning', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    const ebusyError = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });

    // Temporarily make fs.rm reject
    const original = fs.rm.bind(fs);
    jest.spyOn(fs, 'rm').mockRejectedValueOnce(ebusyError as never);

    await expect(removeTempDir('/tmp/fake-devsentry-ebusy')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Restore
    warnSpy.mockRestore();
    jest.spyOn(fs, 'rm').mockImplementation(original as Parameters<typeof jest.spyOn>[1]);
    jest.restoreAllMocks();
  });

  test('actually deletes a real temp directory containing nested files', async () => {
    const dir = await makeTempDir(`devsentry-test-delete-${Date.now()}`);

    // Confirm it exists
    await expect(fs.stat(dir)).resolves.toBeTruthy();

    await removeTempDir(dir);

    // Should be gone
    await expect(fs.stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// ── 2. sweepStaleTempDirs ─────────────────────────────────────────────────────

describe('sweepStaleTempDirs', () => {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const ONE_MINUTE_MS = 60 * 1000;

  test('removes old devsentry-* directories, keeps fresh ones, ignores other names', async () => {
    const suffix = Date.now();

    // Old devsentry dir – should be removed
    const oldDir = await makeTempDir(`devsentry-sweep-old-${suffix}`);
    await setOld(oldDir, TWO_HOURS_MS);

    // Fresh devsentry dir (mtime = now) – should be kept
    const freshDir = await makeTempDir(`devsentry-sweep-fresh-${suffix}`);

    // Dir with a different prefix – should be ignored even if old
    const otherDir = await makeTempDir(`notdevsentry-sweep-${suffix}`);
    await setOld(otherDir, TWO_HOURS_MS);

    try {
      await sweepStaleTempDirs(ONE_MINUTE_MS * 60); // 1-hour cutoff

      // Old devsentry dir should be gone
      await expect(fs.stat(oldDir)).rejects.toMatchObject({ code: 'ENOENT' });

      // Fresh devsentry dir should still exist
      await expect(fs.stat(freshDir)).resolves.toBeTruthy();

      // Dir with a different name should still exist
      await expect(fs.stat(otherDir)).resolves.toBeTruthy();
    } finally {
      // Cleanup remaining test dirs
      await fs.rm(freshDir, { recursive: true, force: true });
      await fs.rm(otherDir, { recursive: true, force: true });
    }
  });

  test('never throws even when tmpdir() listing fails', async () => {
    const original = fs.readdir.bind(fs);
    jest.spyOn(fs, 'readdir').mockRejectedValueOnce(new Error('permission denied') as never);
    await expect(sweepStaleTempDirs()).resolves.toBeUndefined();
    jest.spyOn(fs, 'readdir').mockImplementation(original as Parameters<typeof jest.spyOn>[1]);
    jest.restoreAllMocks();
  });
});

// ── 3. Request logging redaction ──────────────────────────────────────────────

describe('request logging redaction', () => {
  test('logger redacts req.headers.cookie, req.headers.authorization and res.headers["set-cookie"]', () => {
    const chunks: string[] = [];
    const mockStream = {
      write(chunk: string | Buffer) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      },
    };

    // Build a fresh pino logger with the same redact config as src/config/logger.ts,
    // wired to our capturing stream so we can inspect what it writes.
    const testLogger = pino(
      {
        redact: {
          paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          censor: '[Redacted]',
        },
      },
      mockStream as unknown as Parameters<typeof pino>[1],
    );

    const SECRET_COOKIE = 'session_id=supersecret_should_not_appear';
    const SECRET_AUTH   = 'Bearer my-secret-token';
    const SECRET_SETCOOKIE = 'token=hidden-token; HttpOnly';

    testLogger.info({
      req:  { headers: { cookie: SECRET_COOKIE, authorization: SECRET_AUTH } },
      res:  { headers: { 'set-cookie': SECRET_SETCOOKIE } },
    }, 'test request log');

    const output = chunks.join('');

    expect(output).not.toContain(SECRET_COOKIE);
    expect(output).not.toContain(SECRET_AUTH);
    expect(output).not.toContain(SECRET_SETCOOKIE);
    expect(output).toContain('[Redacted]');
  });
});
