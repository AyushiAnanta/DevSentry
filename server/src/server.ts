import { app } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { markInterruptedScansFailed } from './services/scanRecoveryService';
import { sweepStaleTempDirs } from './services/repoService';

void connectDb().then(async () => {
  await markInterruptedScansFailed();
  await sweepStaleTempDirs();
  app.listen(env.PORT);
}).catch(error => {
  process.stderr.write(`Database connection failed: ${String(error)}\n`);
  process.exitCode = 1;
});

