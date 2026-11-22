import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './config/logger';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import passport from './config/passport';
import { env } from './config/env';
import { apiRouter } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimit';

export const app = express();
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(pinoHttp({ logger, enabled: env.NODE_ENV !== 'test' }));
app.use('/api', generalLimiter);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'DevSentry API', version: '1.0.0' },
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token' } },
      schemas: {
        ProjectInput: { type: 'object', required: ['name', 'url'], properties: { name: { type: 'string', example: 'payments-service' }, url: { type: 'string', format: 'uri', example: 'https://github.com/acme/payments' } } },
        ProjectPatch: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string', format: 'uri' } } },
        User: { type: 'object', required: ['id', 'email', 'name'], properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' }, name: { type: 'string' }, avatar: { type: 'string', format: 'uri' } } },
        Project: { type: 'object', required: ['name', 'source'], properties: { name: { type: 'string' }, source: { type: 'object', required: ['type', 'url'], properties: { type: { type: 'string', enum: ['github'] }, url: { type: 'string', format: 'uri' } } } } },
        Scan: { type: 'object', required: ['scanId', 'status', 'stage', 'summary', 'warnings', 'timing', 'aiStatus'], properties: { scanId: { type: 'string' }, status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] }, stage: { type: 'string', nullable: true, enum: ['cloning', 'analyzing', 'scoring', 'saving', null] }, summary: { type: 'object', properties: { riskScore: { type: 'number' }, counts: { type: 'object', properties: { critical: { type: 'integer' }, high: { type: 'integer' }, medium: { type: 'integer' }, low: { type: 'integer' }, info: { type: 'integer' } } } } }, warnings: { type: 'array', items: { type: 'string' } }, error: { type: 'string' }, aiStatus: { type: 'string', enum: ['skipped', 'partial', 'complete'] }, timing: { type: 'object', properties: { startedAt: { type: 'string', format: 'date-time', nullable: true }, finishedAt: { type: 'string', format: 'date-time', nullable: true }, durationMs: { type: 'integer', nullable: true } } } } },
        Finding: { type: 'object', required: ['filePath', 'line', 'ruleId', 'ruleIds', 'source', 'severity', 'category', 'message', 'riskScore'], properties: { filePath: { type: 'string' }, line: { type: 'integer' }, endLine: { type: 'integer' }, ruleId: { type: 'string' }, ruleIds: { type: 'array', items: { type: 'string' } }, source: { type: 'string', enum: ['semgrep', 'lizard', 'llm'] }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] }, category: { type: 'string' }, message: { type: 'string' }, suggestion: { type: 'string' }, explanation: { type: 'string' }, aiGenerated: { type: 'boolean' }, snippet: { type: 'string' }, confidence: { type: 'number' }, riskScore: { type: 'number' } } },
        FileRisk: { type: 'object', required: ['filePath', 'language', 'riskScore', 'factors', 'metrics'], properties: { filePath: { type: 'string' }, language: { type: 'string' }, riskScore: { type: 'number', minimum: 0, maximum: 100 }, factors: { type: 'array', items: { type: 'object', required: ['name', 'raw', 'normalized', 'weight', 'contribution'], properties: { name: { type: 'string' }, raw: { type: 'number' }, normalized: { type: 'number' }, weight: { type: 'number' }, contribution: { type: 'number' } } } }, metrics: { type: 'object' } } },
        FileSource: { type: 'object', required: ['filePath', 'content'], properties: { filePath: { type: 'string' }, content: { type: 'string' } } },
        ApiError: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } } } } },
      },
    },
    paths: { '/api/health': { get: { summary: 'Health check', responses: { '200': { description: 'Service is healthy' } } } }, '/api/dashboard': { get: { summary: 'Owner dashboard data', security: [{ cookieAuth: [] }], responses: { '200': { description: 'Dashboard counts and risk trend' } } } } },
  },
  apis: [`${__dirname}/routes/*.js`, `${__dirname}/routes/*.ts`],
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', apiRouter);
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use(errorHandler);
