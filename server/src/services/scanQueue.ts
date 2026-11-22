import { env } from '../config/env';
import { logger } from '../config/logger';

type ScanTask = () => Promise<void>;
interface QueuedTask { ownerId: string; run: ScanTask }

const pending: QueuedTask[] = [];
const activeOwners = new Set<string>();
let activeCount = 0;
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (activeCount < env.SCAN_CONCURRENCY && pending.length) {
      const task = pending.shift();
      if (!task) continue;
      activeCount++;
      void Promise.resolve()
        .then(task.run)
        .catch((error: unknown) => {
          logger.error({
            err: error instanceof Error ? error : new Error(String(error)),
          }, 'A queued scan task ended unexpectedly.');
        })
        .finally(() => {
          activeCount--;
          activeOwners.delete(task.ownerId);
          void drain();
        });
    }
  } finally {
    draining = false;
  }
}

export function enqueueScan(ownerId: string, run: ScanTask): boolean {
  if (activeOwners.has(ownerId)) return false;
  activeOwners.add(ownerId);
  pending.push({ ownerId, run });
  void drain();
  return true;
}

export function isScanActiveForOwner(ownerId: string): boolean {
  return activeOwners.has(ownerId);
}

export function queueSnapshot(): { active: number; queued: number; owners: number } {
  return { active: activeCount, queued: pending.length, owners: activeOwners.size };
}

