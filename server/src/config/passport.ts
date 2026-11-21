import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './env';
import { User } from '../models/User';
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) passport.use(new GoogleStrategy({ clientID:env.GOOGLE_CLIENT_ID, clientSecret:env.GOOGLE_CLIENT_SECRET, callbackURL:env.GOOGLE_CALLBACK_URL }, async (_a,_r,profile,done) => {
  try { const email=profile.emails?.[0]?.value; if (!email) return done(new Error('Google account has no email')); const record=await User.findOneAndUpdate({googleId:profile.id},{googleId:profile.id,email,name:profile.displayName,avatar:profile.photos?.[0]?.value},{new:true,upsert:true,setDefaultsOnInsert:true}); const user={id:String(record._id),email:record.email,name:record.name,avatar:record.avatar}; return done(null,user); } catch(error) { return done(error as Error); }
}));
export default passport;
