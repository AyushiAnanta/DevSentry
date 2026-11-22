import { Router } from 'express';
import { authRouter } from './auth';import { projectRouter } from './projects';import { scanRouter } from './scans';import { quickScanRouter } from './quickScan';
import { requireAuth } from '../middleware/requireAuth';import { dashboard } from '../controllers/dashboardController';
export const apiRouter=Router();apiRouter.use('/auth',authRouter);apiRouter.get('/dashboard',requireAuth,dashboard);apiRouter.use('/projects',projectRouter);apiRouter.use('/scans',scanRouter);apiRouter.use('/quick-scan',quickScanRouter);
