import { Router } from 'express';
import { quickScan } from '../controllers/quickScanController';
import { requireAuth } from '../middleware/requireAuth';
import { quickScanLimiter } from '../middleware/rateLimit';
export const quickScanRouter=Router();quickScanRouter.use(requireAuth,quickScanLimiter);
/** @openapi
 * /api/quick-scan:
 *   post:
 *     summary: Analyze a code snippet without persistence
 *     security: [{ cookieAuth: [] }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [language, code], properties: { language: { type: string, enum: [javascript, typescript, python, java] }, code: { type: string, maxLength: 20480 } } } } } }
 *     responses: { '200': { description: Findings and metrics }, '400': { description: Invalid input }, '413': { description: Body too large }, '429': { description: Rate limited }, '504': { description: Timeout } }
 */
quickScanRouter.post('/',quickScan);
