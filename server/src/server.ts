import { app } from './app';import { connectDb } from './config/db';import { env } from './config/env';import { markInterruptedScansFailed } from './services/scanRecoveryService';
void connectDb().then(async()=>{await markInterruptedScansFailed();app.listen(env.PORT);}).catch(error=>{process.stderr.write(`Database connection failed: ${String(error)}\n`);process.exitCode=1;});
