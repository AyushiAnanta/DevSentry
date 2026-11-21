import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import passport from '../config/passport';
import { requireAuth } from '../middleware/requireAuth';
import { authLimiter } from '../middleware/rateLimit';
export const authRouter=Router();
/** @openapi
 * /api/auth/google:
 *   get:
 *     summary: Begin Google OAuth sign-in
 *     responses: { '302': { description: Redirect to Google } }
 */
authRouter.get('/google',authLimiter,(_req,res,next)=>{if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET){res.status(501).json({error:{code:'OAUTH_UNCONFIGURED',message:'Google OAuth is not configured'}});return;}passport.authenticate('google',{scope:['profile','email']})(_req,res,next);});
/** @openapi
 * /api/auth/google/callback:
 *   get:
 *     summary: Complete Google OAuth and issue cookie
 *     responses: { '302': { description: Redirect to dashboard or landing page } }
 */
authRouter.get('/google/callback',authLimiter,(req,res,next)=>{passport.authenticate('google',{session:false},(error:Error|null,user:{id:string}|false)=>{if(error||!user){res.redirect(`${env.CLIENT_URL}/?error=auth_failed`);return;}const token=jwt.sign({id:user.id},env.JWT_SECRET,{expiresIn:'7d'});res.cookie('token',token,{httpOnly:true,sameSite:'lax',secure:env.NODE_ENV==='production',maxAge:7*24*60*60*1000});res.redirect(`${env.CLIENT_URL}/dashboard`);})(req,res,next);});
/** @openapi
 * /api/auth/me:
 *   get:
 *     summary: Get current user
 *     security: [{ cookieAuth: [] }]
 *     responses: { '200': { description: User profile }, '401': { description: Not authenticated } }
 */
authRouter.get('/me',requireAuth,(req,res)=>res.json({id:req.user!.id,email:req.user!.email,name:req.user!.name,avatar:req.user!.avatar}));
/** @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Clear authentication cookie
 *     responses: { '204': { description: Logged out } }
 */
authRouter.post('/logout',(_req,res)=>{res.clearCookie('token',{httpOnly:true,sameSite:'lax',secure:env.NODE_ENV==='production'});res.status(204).end();});
