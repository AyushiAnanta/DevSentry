
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
          const email = profile.emails?.[0]?.value?.toLowerCase();

          if (!email) {
            return done(new Error('Google account has no email'));
          }

          // First, look for an existing Google account.
          let record = await User.findOne({
            googleId: profile.id,
          });

          if (!record) {
            // Do not automatically link an existing local account.
            const existingEmail = await User.findOne({ email });

            if (existingEmail) {
              return done(
                new Error(
                  'An account with this email already exists. Sign in using your existing method.'
                )
              );
            }

            // Create a new Google account.
            record = await User.create({
              googleId: profile.id,
              email,
              name: profile.displayName,
              avatar: profile.photos?.[0]?.value,
            });
          } else {
            // Update the existing Google account.
            record.email = email;
            record.name = profile.displayName;
            record.avatar = profile.photos?.[0]?.value;

            await record.save();
          }

          // Return authenticated user details to Passport.
          return done(null, {
            id: String(record._id),
            email: record.email,
            name: record.name,
            avatar: record.avatar,
            twoFactorEnabled: record.twoFactorEnabled ?? false,
            authVersion: record.authVersion ?? 0,
          });
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

export default passport;
