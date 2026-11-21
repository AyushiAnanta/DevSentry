import { Router } from 'express';
import { authRouter } from './auth';import { projectRouter } from './projects';import { scanRouter } from './scans';import { quickScanRouter } from './quickScan';
export const apiRouter=Router();apiRouter.use('/auth',authRouter);apiRouter.use('/projects',projectRouter);apiRouter.use('/scans',scanRouter);apiRouter.use('/quick-scan',quickScanRouter);
