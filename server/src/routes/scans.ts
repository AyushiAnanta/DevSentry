import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
export const scanRouter=Router();scanRouter.use(requireAuth);
/** @openapi
 * /api/scans/{id}:
 *   get:
 *     summary: Get scan status (Phase 2)
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { '501': { description: Not implemented } }
 */
scanRouter.get('/:id',(_req,res)=>res.status(501).json({error:'Not implemented'}));
/** @openapi
 * /api/scans/{id}/findings:
 *   get:
 *     summary: List scan findings (Phase 2)
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { '501': { description: Not implemented } }
 */
scanRouter.get('/:id/findings',(_req,res)=>res.status(501).json({error:'Not implemented'}));
