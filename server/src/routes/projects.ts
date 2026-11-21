import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/projectController';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody } from '../middleware/validate';
const github=z.string().url().refine(value=>/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value),'Must be a public GitHub repository URL');
const createSchema=z.object({name:z.string().trim().min(1).max(100),url:github});
const patchSchema=z.object({name:z.string().trim().min(1).max(100).optional(),url:github.optional()}).refine(v=>Object.keys(v).length>0);
export const projectRouter=Router();
projectRouter.use(requireAuth);
/** @openapi
 * /api/projects:
 *   get:
 *     summary: List current user's projects
 *     security: [{ cookieAuth: [] }]
 *     responses: { '200': { description: Project list } }
 *   post:
 *     summary: Create a GitHub project
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ProjectInput' }
 *     responses: { '201': { description: Created }, '400': { description: Invalid input } }
 */
projectRouter.get('/',controller.list);
projectRouter.post('/',validateBody(createSchema),controller.create);
/** @openapi
 * /api/projects/{id}:
 *   parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *   get:
 *     summary: Get an owned project
 *     security: [{ cookieAuth: [] }]
 *     responses: { '200': { description: Project }, '404': { description: Not found } }
 *   patch:
 *     summary: Update an owned project
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ProjectPatch' }
 *     responses: { '200': { description: Updated }, '404': { description: Not found } }
 *   delete:
 *     summary: Delete an owned project and its analysis data
 *     security: [{ cookieAuth: [] }]
 *     responses: { '204': { description: Deleted }, '404': { description: Not found } }
 */
projectRouter.get('/:id',controller.get);
projectRouter.patch('/:id',validateBody(patchSchema),controller.update);
projectRouter.delete('/:id',controller.remove);
/** @openapi
 * /api/projects/{id}/scans:
 *   post:
 *     summary: Start repository scan (Phase 2)
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { '501': { description: Not implemented } }
 */
projectRouter.post('/:id/scans',(_req,res)=>res.status(501).json({error:'Not implemented'}));
