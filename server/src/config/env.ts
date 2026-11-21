import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({ PORT:z.coerce.number().default(5000), NODE_ENV:z.enum(['development','test','production']).default('development'), CLIENT_URL:z.string().url().default('http://localhost:5173'), MONGODB_URI:z.string().default(''), JWT_SECRET:z.string().default(''), GOOGLE_CLIENT_ID:z.string().default(''), GOOGLE_CLIENT_SECRET:z.string().default(''), GOOGLE_CALLBACK_URL:z.string().url().default('http://localhost:5000/api/auth/google/callback'), AI_PROVIDER:z.string().default('gemini'), GEMINI_API_KEY:z.string().default(''), GROQ_API_KEY:z.string().default(''), MAX_REPO_SIZE_MB:z.coerce.number().default(100), CLONE_DEPTH:z.coerce.number().default(500), SCAN_TIMEOUT_MS:z.coerce.number().default(180000) });
const parsed=schema.parse(process.env);
if(parsed.NODE_ENV!=='test'&&parsed.MONGODB_URI.length===0)throw new Error('MONGODB_URI is required');
if(parsed.NODE_ENV!=='test'&&parsed.JWT_SECRET.length<16)throw new Error('JWT_SECRET must contain at least 16 characters');
export const env={...parsed,MONGODB_URI:parsed.MONGODB_URI||'mongodb://127.0.0.1:27017/devsentry',JWT_SECRET:parsed.JWT_SECRET||randomBytes(32).toString('hex')};
