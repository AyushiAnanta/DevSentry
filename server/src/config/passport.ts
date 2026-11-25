import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './env';
import { User } from '../models/User';

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.trim().toLowerCase();
          if (!email) return done(new Error('Google account has no email'));

          let record = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
          if (record) {
            record.googleId = profile.id;
            record.email = email;
            record.name = profile.displayName || record.name;
            if (profile.photos?.[0]?.value) record.avatar = profile.photos[0].value;
            await record.save();
          } else {
            record = await User.create({
              googleId: profile.id,
              email,
              name: profile.displayName || email.split('@')[0],
              avatar: profile.photos?.[0]?.value,
            });
          }

          return done(null, {
            id: String(record._id),
            email: record.email,
            name: record.name,
            avatar: record.avatar,
          });
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

export default passport;
