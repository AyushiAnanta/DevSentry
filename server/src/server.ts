import { app } from './app';import { connectDb } from './config/db';import { env } from './config/env';
void connectDb().then(()=>app.listen(env.PORT)).catch(error=>{process.stderr.write(`Database connection failed: ${String(error)}\n`);process.exitCode=1;});
