import { NextFunction,Request,Response } from 'express';
import { getDashboard } from '../services/dashboardService';
export async function dashboard(req:Request,res:Response,next:NextFunction):Promise<void>{try{res.json(await getDashboard(req.user!.id));}catch(error){next(error);}}
