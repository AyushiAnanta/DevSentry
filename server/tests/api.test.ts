import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { User } from '../src/models/User';
import { Project } from '../src/models/Project';
import { Scan } from '../src/models/Scan';
import { Finding } from '../src/models/Finding';
import { FileRisk } from '../src/models/FileRisk';
import * as scanService from '../src/services/scanService';

let mongo: MongoMemoryServer;
let userA: { id: string };
let tokenA: string;
let tokenB: string;
const cookie = (token: string): string => `token=${token}`;
const emptyFindingCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Project.deleteMany({}), Scan.deleteMany({}), Finding.deleteMany({}), FileRisk.deleteMany({})]);
  const a = await User.create({ googleId: 'a', email: 'a@example.com', name: 'A' });
  const b = await User.create({ googleId: 'b', email: 'b@example.com', name: 'B' });
  userA = { id: a.id };
  tokenA = jwt.sign({ id: a.id }, env.JWT_SECRET, { expiresIn: '7d' });
  tokenB = jwt.sign({ id: b.id }, env.JWT_SECRET, { expiresIn: '7d' });
});

describe('API', () => {
  test('health returns 200', async () => {
    const result = await request(app).get('/api/health');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ok');
  });
  test('serves the Swagger UI and API contract', async () => {
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
    const spec = await request(app).get('/api/docs/swagger-ui-init.js');
    expect(spec.status).toBe(200);
    expect(spec.text).toContain('/api/quick-scan');
    expect(spec.text).toContain('FileRisk');
  });
  test('authenticates the current user only with a valid cookie', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(tokenA))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(`${tokenA}bad`))).status).toBe(401);
    const expired = jwt.sign({ id: userA.id }, env.JWT_SECRET, { expiresIn: -1 });
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie(expired))).status).toBe(401);
  });
  test('logout clears the token', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });
  test('creates and lists a project and rejects invalid hosts', async () => {
    const created = await request(app).post('/api/projects').set('Cookie', cookie(tokenA)).send({ name: 'API', url: 'https://github.com/acme/api' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('API');
    expect((await request(app).get('/api/projects').set('Cookie', cookie(tokenA))).body).toHaveLength(1);
    const rejected = await request(app).post('/api/projects').set('Cookie', cookie(tokenA)).send({ name: 'bad', url: 'https://evil.example/acme/api' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
  });
  test('gets and updates an owned project', async () => {
    const project = await Project.create({ owner: userA.id, name: 'Old', source: { type: 'github', url: 'https://github.com/a/b' } });
    expect((await request(app).get(`/api/projects/${project.id}`).set('Cookie', cookie(tokenA))).status).toBe(200);
    const updated = await request(app).patch(`/api/projects/${project.id}`).set('Cookie', cookie(tokenA)).send({ name: 'New' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('New');
  });
  test('hides another owner’s project for get, update, and delete', async () => {
    const project = await Project.create({ owner: userA.id, name: 'Secret', source: { type: 'github', url: 'https://github.com/a/b' } });
    expect((await request(app).get(`/api/projects/${project.id}`).set('Cookie', cookie(tokenB))).status).toBe(404);
    expect((await request(app).patch(`/api/projects/${project.id}`).set('Cookie', cookie(tokenB)).send({ name: 'Stolen' })).status).toBe(404);
    expect((await request(app).delete(`/api/projects/${project.id}`).set('Cookie', cookie(tokenB))).status).toBe(404);
  });
  test('deletes project scans, findings, and file risks', async () => {
    const project = await Project.create({ owner: userA.id, name: 'Delete', source: { type: 'github', url: 'https://github.com/a/b' } });
    const scan = await Scan.create({ project: project.id, owner: userA.id, status: 'done' });
    await Finding.create({ scan: scan.id, owner: userA.id, filePath: 'a.ts', line: 1, ruleId: 'test', source: 'lizard', severity: 'low', category: 'test', message: 'x', riskScore: 1 });
    await FileRisk.create({ scan: scan.id, owner: userA.id, filePath: 'a.ts', language: 'typescript', riskScore: 10, factors: [], metrics: { nloc: 1, maxCcn: 1, avgCcn: 1, functionCount: 1, maxParams: 0, commits90d: 0, authors: 0, bugFixCommits: 0, findingCounts: emptyFindingCounts } });
    expect((await request(app).delete(`/api/projects/${project.id}`).set('Cookie', cookie(tokenA))).status).toBe(204);
    expect(await Scan.countDocuments()).toBe(0);
    expect(await Finding.countDocuments()).toBe(0);
    expect(await FileRisk.countDocuments()).toBe(0);
  });
  test('scan creation returns 202, returns 409 for active work, and keeps quick scan at 501', async () => {
    const project = await Project.create({ owner: userA.id, name: 'S', source: { type: 'github', url: 'https://github.com/a/b' } });
    const start = jest.spyOn(scanService, 'startProjectScan').mockResolvedValue({ kind: 'started', scanId: '507f1f77bcf86cd799439011' });
    const created = await request(app).post(`/api/projects/${project.id}/scans`).set('Cookie', cookie(tokenA));
    expect(created.status).toBe(202);
    expect(created.body).toEqual({ scanId: '507f1f77bcf86cd799439011', status: 'queued' });
    start.mockResolvedValue({ kind: 'conflict' });
    expect((await request(app).post(`/api/projects/${project.id}/scans`).set('Cookie', cookie(tokenA))).status).toBe(409);
    start.mockResolvedValue({ kind: 'not-found' });
    expect((await request(app).post(`/api/projects/${new mongoose.Types.ObjectId()}/scans`).set('Cookie', cookie(tokenA))).status).toBe(404);
    start.mockRestore();
    expect((await request(app).post('/api/quick-scan').set('Cookie', cookie(tokenA))).status).toBe(501);
  });
  test('scan reads require auth and return 404 for missing or foreign scans', async () => {
    const project = await Project.create({ owner: userA.id, name: 'S', source: { type: 'github', url: 'https://github.com/a/b' } });
    const scan = await Scan.create({ project: project.id, owner: userA.id, status: 'done' });
    expect((await request(app).get(`/api/scans/${scan.id}`)).status).toBe(401);
    expect((await request(app).get('/api/scans/x').set('Cookie', cookie(tokenA))).status).toBe(404);
    expect((await request(app).get(`/api/scans/${scan.id}`).set('Cookie', cookie(tokenB))).status).toBe(404);
    expect((await request(app).get(`/api/scans/${scan.id}/findings`).set('Cookie', cookie(tokenB))).status).toBe(404);
    expect((await request(app).get(`/api/scans/${scan.id}/files`).set('Cookie', cookie(tokenB))).status).toBe(404);
  });
  test('filters and paginates owned findings and file risks', async () => {
    const project = await Project.create({ owner: userA.id, name: 'Results', source: { type: 'github', url: 'https://github.com/a/b' } });
    const scan = await Scan.create({ project: project.id, owner: userA.id, status: 'done', stage: null });
    await Finding.insertMany([
      { scan: scan.id, owner: userA.id, filePath: 'src/a.ts', line: 4, ruleId: 'critical', source: 'semgrep', severity: 'critical', category: 'security', message: 'critical issue', riskScore: 80 },
      { scan: scan.id, owner: userA.id, filePath: 'src/b.ts', line: 8, ruleId: 'high', source: 'semgrep', severity: 'high', category: 'security', message: 'high issue', riskScore: 60 },
      { scan: scan.id, owner: userA.id, filePath: 'src/b.ts', line: 12, ruleId: 'medium', source: 'semgrep', severity: 'medium', category: 'bug', message: 'medium issue', riskScore: 40 },
    ]);
    const filter = await request(app).get(`/api/scans/${scan.id}/findings?severity=high&category=security&file=b.ts&page=1&limit=1`).set('Cookie', cookie(tokenA));
    expect(filter.status).toBe(200);
    expect(filter.body.total).toBe(1);
    expect(filter.body.items[0].message).toBe('high issue');
    const page = await request(app).get(`/api/scans/${scan.id}/findings?page=1&limit=2`).set('Cookie', cookie(tokenA));
    expect(page.body.items.map((item: { severity: string }) => item.severity)).toEqual(['critical', 'high']);
    const metrics = { nloc: 2, maxCcn: 1, avgCcn: 1, functionCount: 2, maxParams: 1, commits90d: 0, authors: 0, bugFixCommits: 0, findingCounts: emptyFindingCounts };
    await FileRisk.insertMany([
      { scan: scan.id, owner: userA.id, filePath: 'src/a.ts', language: 'typescript', riskScore: 70, factors: [], metrics },
      { scan: scan.id, owner: userA.id, filePath: 'src/b.ts', language: 'typescript', riskScore: 10, factors: [], metrics },
    ]);
    const files = await request(app).get(`/api/scans/${scan.id}/files?page=1&limit=1`).set('Cookie', cookie(tokenA));
    expect(files.status).toBe(200);
    expect(files.body.total).toBe(2);
    expect(files.body.items[0].filePath).toBe('src/a.ts');
    expect((await request(app).get(`/api/scans/${scan.id}/findings`)).status).toBe(401);
  });
});
