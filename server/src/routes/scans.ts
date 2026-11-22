import { Router } from 'express';
import * as controller from '../controllers/scanController';
import { requireAuth } from '../middleware/requireAuth';

export const scanRouter = Router();
scanRouter.use(requireAuth);

/** @openapi
 * /api/scans/{id}:
 *   get:
 *     summary: Get scan status, stage, summary, warnings, and timing
 *     security: [{ cookieAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       '200': { description: Scan status, content: { application/json: { schema: { $ref: '#/components/schemas/Scan' } } } }
 *       '404': { description: Scan not found or not owned }
 */
scanRouter.get('/:id', controller.getStatus);

/** @openapi
 * /api/scans/{id}/findings:
 *   get:
 *     summary: List filtered and paginated findings
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: severity, schema: { type: string, enum: [critical, high, medium, low, info] } }
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: file, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       '200': { description: Paginated findings, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/Finding' } }, page: { type: integer }, limit: { type: integer }, total: { type: integer }, totalPages: { type: integer } } } } } }
 *       '404': { description: Scan not found or not owned }
 */
scanRouter.get('/:id/findings', controller.getFindings);

/** @openapi
 * /api/scans/{id}/files:
 *   get:
 *     summary: List per-file risk scores, highest risk first
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       '200': { description: Paginated file risks, content: { application/json: { schema: { type: object, properties: { items: { type: array, items: { $ref: '#/components/schemas/FileRisk' } }, page: { type: integer }, limit: { type: integer }, total: { type: integer }, totalPages: { type: integer } } } } } }
 *       '404': { description: Scan not found or not owned }
 */
scanRouter.get('/:id/files', controller.getFiles);
