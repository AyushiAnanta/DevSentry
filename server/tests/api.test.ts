import mongoose from 'mongoose';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Request,Response,NextFunction } from 'express';
import passport from '../src/config/passport';
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
import { FileSource } from '../src/models/FileSource';
import * as scanService from '../src/services/scanService';
import * as metricsService from '../src/services/metricsService';
import * as semgrepService from '../src/services/semgrepService';
import { errorHandler } from '../src/middleware/errorHandler';
import { quickScanLimiter } from '../src/middleware/rateLimit';

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
  await Promise.all([User.deleteMany({}), Project.deleteMany({}), Scan.deleteMany({}), Finding.deleteMany({}), FileRisk.deleteMany({}),FileSource.deleteMany({})]);
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
  test('Google OAuth redirects to Google and handles callback success and failure',async()=>{
    const previous={id:env.GOOGLE_CLIENT_ID,secret:env.GOOGLE_CLIENT_SECRET};env.GOOGLE_CLIENT_ID='test-client';env.GOOGLE_CLIENT_SECRET='test-secret';
    let failure=false;
    const auth=jest.spyOn(passport,'authenticate') as unknown as jest.Mock;
    auth.mockImplementation((_strategy:string,_options:unknown,callback?: (error:Error|null,user:{id:string}|false)=>void)=>( _req:Request,res:Response,next:NextFunction)=>{if(callback){callback(failure?new Error('OAuth failure'):null,failure?false:{id:userA.id});return;}void next;res.redirect('https://accounts.google.com/o/oauth2/v2/auth');});
    try{
      const google=await request(app).get('/api/auth/google');expect(google.status).toBe(302);expect(google.headers.location).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      const success=await request(app).get('/api/auth/google/callback');expect(success.status).toBe(302);expect(success.headers.location).toBe(`${env.CLIENT_URL}/dashboard`);expect(success.headers['set-cookie']?.[0]).toContain('token=');
      failure=true;const rejected=await request(app).get('/api/auth/google/callback');expect(rejected.status).toBe(302);expect(rejected.headers.location).toBe(`${env.CLIENT_URL}/?error=auth_failed`);
    }finally{auth.mockRestore();env.GOOGLE_CLIENT_ID=previous.id;env.GOOGLE_CLIENT_SECRET=previous.secret;}
  });
  test('error handler hides server errors and preserves client status',()=>{
    const json=jest.fn();const status=jest.fn().mockReturnValue({json});
    errorHandler(Object.assign(new Error('bad input'),{status:400}),{} as Request,{status} as unknown as Response,jest.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(400);expect(json).toHaveBeenCalledWith({error:{code:'BAD_REQUEST',message:'bad input'}});
    status.mockClear();json.mockClear();
    errorHandler(new Error('contains secret'),{} as Request,{status} as unknown as Response,jest.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(500);expect(json).toHaveBeenCalledWith({error:{code:'INTERNAL_ERROR',message:'Internal server error'}});
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
  test('scan creation returns 202 and 409 for active work, quick scan validates limits', async () => {
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
    expect((await request(app).post('/api/quick-scan').set('Cookie', cookie(tokenA)).send({language:'typescript',code:'x'.repeat(20*1024+1)})).status).toBe(413);
    expect((await request(app).post('/api/quick-scan').set('Cookie', cookie(tokenA)).send({language:'ruby',code:'puts 1'})).status).toBe(400);
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
  test('dashboard is owner-scoped and file source rejects traversal and foreign scans',async()=>{
    const project=await Project.create({owner:userA.id,name:'Private',source:{type:'github',url:'https://github.com/a/b'}});
    const scan=await Scan.create({project:project.id,owner:userA.id,status:'done',summary:{riskScore:42,counts:emptyFindingCounts}});
    await FileSource.create({scan:scan.id,owner:userA.id,filePath:'src/main.ts',content:'const value = 1;'});
    const dashboard=await request(app).get('/api/dashboard').set('Cookie',cookie(tokenA));
    expect(dashboard.status).toBe(200);expect(dashboard.body.projectCount).toBe(1);expect(dashboard.body.scanCount).toBe(1);expect(dashboard.body.riskTrend).toHaveLength(1);
    const history=await request(app).get(`/api/projects/${project.id}/scans`).set('Cookie',cookie(tokenA));expect(history.status).toBe(200);expect(history.body[0].scanId).toBe(scan.id);
    expect((await request(app).get(`/api/projects/${project.id}/scans`).set('Cookie',cookie(tokenB))).status).toBe(404);
    expect((await request(app).get('/api/dashboard').set('Cookie',cookie(tokenB))).body.projectCount).toBe(0);
    expect((await request(app).get(`/api/scans/${scan.id}/files/content?path=../main.ts`).set('Cookie',cookie(tokenA))).status).toBe(400);
    expect((await request(app).get(`/api/scans/${scan.id}/files/content?path=src/main.ts`).set('Cookie',cookie(tokenB))).status).toBe(404);
    const content=await request(app).get(`/api/scans/${scan.id}/files/content?path=src/main.ts`).set('Cookie',cookie(tokenA));
    expect(content.status).toBe(200);expect(content.body.content).toBe('const value = 1;');
  });
  test('quick scan runs without persistence and removes its temporary source',async()=>{
    const oldKeys={gemini:env.GEMINI_API_KEY,groq:env.GROQ_API_KEY};env.GEMINI_API_KEY='';env.GROQ_API_KEY='';
    const lizard=jest.spyOn(metricsService,'runLizard').mockResolvedValue([]);
    const semgrep=jest.spyOn(semgrepService,'runSemgrep').mockResolvedValue({rawJson:'{"results":[]}',warnings:[]});
    const before=(await fs.readdir(tmpdir())).filter(name=>name.startsWith('devsentry-quick-'));
    try{
      const response=await request(app).post('/api/quick-scan').set('Cookie',cookie(tokenA)).send({language:'typescript',code:'export const answer = 42;'});
      expect(response.status).toBe(200);expect(response.body).toMatchObject({findings:[],aiStatus:'skipped'});expect(JSON.stringify(response.body)).not.toMatch(/devsentry-quick|\\Temp\\|\/tmp\//i);
      expect((await fs.readdir(tmpdir())).filter(name=>name.startsWith('devsentry-quick-'))).toEqual(before);
      expect(await Finding.countDocuments()).toBe(0);expect(lizard).toHaveBeenCalledTimes(1);expect(semgrep).toHaveBeenCalledTimes(1);
    }finally{env.GEMINI_API_KEY=oldKeys.gemini;env.GROQ_API_KEY=oldKeys.groq;lizard.mockRestore();semgrep.mockRestore();}
  });
  test('quick scan cleans up after a tool failure and whole-request timeout',async()=>{
    const oldKeys={gemini:env.GEMINI_API_KEY,groq:env.GROQ_API_KEY,timeout:env.SCAN_TIMEOUT_MS};env.GEMINI_API_KEY='';env.GROQ_API_KEY='';
    const before=(await fs.readdir(tmpdir())).filter(name=>name.startsWith('devsentry-quick-'));
    const semgrep=jest.spyOn(semgrepService,'runSemgrep').mockResolvedValue({rawJson:'{"results":[]}',warnings:[]});
    const fail=jest.spyOn(metricsService,'runLizard').mockRejectedValue(new Error('tool failed'));
    try{
      expect((await request(app).post('/api/quick-scan').set('Cookie',cookie(tokenA)).send({language:'javascript',code:'const x = 1;'})).status).toBe(500);
      expect((await fs.readdir(tmpdir())).filter(name=>name.startsWith('devsentry-quick-'))).toEqual(before);
      fail.mockRestore();env.SCAN_TIMEOUT_MS=25;
      const pending=jest.spyOn(metricsService,'runLizard').mockImplementation(()=>new Promise<never>(()=>undefined));
      expect((await request(app).post('/api/quick-scan').set('Cookie',cookie(tokenA)).send({language:'javascript',code:'const x = 1;'})).status).toBe(504);
      pending.mockRestore();
      expect((await fs.readdir(tmpdir())).filter(name=>name.startsWith('devsentry-quick-'))).toEqual(before);
    }finally{env.GEMINI_API_KEY=oldKeys.gemini;env.GROQ_API_KEY=oldKeys.groq;env.SCAN_TIMEOUT_MS=oldKeys.timeout;fail.mockRestore();semgrep.mockRestore();}
  });
  test('quick scan rate limit rejects the eleventh request',async()=>{
    await Promise.all(['::ffff:127.0.0.1','127.0.0.1','::1','::ffff:7f00:1'].map(key=>quickScanLimiter.resetKey(key)));
    const responses=await Promise.all(Array.from({length:11},()=>request(app).post('/api/quick-scan').set('Cookie',cookie(tokenA)).send({language:'ruby',code:'puts 1'})));
    expect(responses.map(response=>response.status).sort((left,right)=>left-right)).toEqual([...Array(10).fill(400),429].sort((left,right)=>left-right));
  });
});
