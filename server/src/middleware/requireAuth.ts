import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { User } from '../models/User';
// Express middleware attaches the authenticated identity to each request.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global { namespace Express { interface User { id:string; email:string; name:string; avatar?:string } } }
export async function requireAuth(req:Request,res:Response,next:NextFunction):Promise<void> { try { const token=req.cookies?.token as string|undefined; if(!token) {res.status(401).json({error:{code:'UNAUTHORIZED',message:'Authentication required'}});return;} const payload=jwt.verify(token,env.JWT_SECRET) as {id?:string}; if(!payload.id||!Types.ObjectId.isValid(payload.id)) throw new Error('Invalid token'); const user=await User.findById(payload.id); if(!user) {res.status(401).json({error:{code:'UNAUTHORIZED',message:'Authentication required'}});return;} req.user={id:user.id,email:user.email,name:user.name,avatar:user.avatar}; next(); } catch {res.status(401).json({error:{code:'UNAUTHORIZED',message:'Authentication required'}});} }
