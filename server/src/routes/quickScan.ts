import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
export const quickScanRouter=Router();quickScanRouter.use(requireAuth);
/** @openapi
 * /api/quick-scan:
 *   post:
 *     summary: Analyze code snippet (Phase 2)
 *     security: [{ cookieAuth: [] }]
 *     responses: { '501': { description: Not implemented } }
 */
quickScanRouter.post('/',(_req,res)=>res.status(501).json({error:'Not implemented'}));
