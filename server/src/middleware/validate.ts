import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
export const validateBody=(schema:ZodSchema)=>(req:Request,res:Response,next:NextFunction):void=>{const parsed=schema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid request body',details:parsed.error.flatten()}});return;}req.body=parsed.data;next();};
