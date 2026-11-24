
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import passport from '../config/passport';
import { requireAuth } from '../middleware/requireAuth';
import { authLimiter } from '../middleware/rateLimit';
import {
  forgotPasswordController,
  resetPasswordController,
  registerController,
  loginController,
} from '../controllers/authController';

export const authRouter = Router();

/** @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register a new account with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               name: { type: string, example: 'Jane Doe' }
 *               email: { type: string, format: email, example: 'user@example.com' }
 *               password: { type: string, format: password, example: 'SecurePassword123!' }
 *     responses:
 *       '201': { description: Account created successfully }
 *       '400': { description: Validation error or account already exists }
 */
authRouter.post('/register', authLimiter, registerController);

/** @openapi
 * /api/auth/login:
 *   post:
 *     summary: Sign in with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: 'user@example.com' }
 *               password: { type: string, format: password, example: 'SecurePassword123!' }
 *     responses:
 *       '200': { description: Login successful, auth cookie set }
 *       '401': { description: Invalid email or password }
 */
authRouter.post('/login', authLimiter, loginController);

/** @openapi
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request a password reset link sent to email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: 'user@example.com' }
 *     responses:
 *       '200': { description: Reset link dispatched if account exists }
 *       '400': { description: Invalid email address }
 */
authRouter.post(
  '/forgot-password',
  authLimiter,
  forgotPasswordController
);

/** @openapi
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset account password using token from reset email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string, example: 'abcdef123456...' }
 *               newPassword: { type: string, format: password, example: 'NewSecurePassword123!' }
 *     responses:
 *       '200': { description: Password reset successfully }
 *       '400': { description: Invalid or expired token }
 */
authRouter.post(
  '/reset-password',
  authLimiter,
  resetPasswordController
);

function issueAuthCookie(
  res: any,
  userId: string,
  authVersion: number
) {
  const token = jwt.sign(
    {
      id: userId,
      authVersion,
    },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

/**
 * Begin Google OAuth sign-in
 */
authRouter.get(
  '/google',
  authLimiter,
  (_req, res, next) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      res.status(501).json({
        error: {
          code: 'OAUTH_UNCONFIGURED',
          message: 'Google OAuth is not configured',
        },
      });
      return;
    }

    passport.authenticate('google', {
      scope: ['profile', 'email'],
    })(_req, res, next);
  }
);

/**
 * Complete Google OAuth
 */
authRouter.get(
  '/google/callback',
  authLimiter,
  (req, res, next) => {
    passport.authenticate(
      'google',
      { session: false },
      (
        error: Error | null,
        user: {
          id: string;
          email: string;
          name: string;
          avatar?: string;
          twoFactorEnabled?: boolean;
          authVersion?: number;
        } | false
      ) => {
        if (error || !user) {
          res.redirect(`${env.CLIENT_URL}/?error=auth_failed`);
          return;
        }

        // If 2FA is enabled, do NOT issue the normal login cookie yet.
        if (user.twoFactorEnabled) {
          const challengeToken = jwt.sign(
            {
              id: user.id,
              purpose: '2fa-login',
            },
            env.JWT_SECRET,
            { expiresIn: '5m' }
          );

          res.cookie('2fa_challenge', challengeToken, {
            httpOnly: true,
            sameSite: 'lax',
            secure: env.NODE_ENV === 'production',
            maxAge: 5 * 60 * 1000,
          });

          res.redirect(`${env.CLIENT_URL}/verify-2fa`);
          return;
        }

        // Normal login when 2FA is disabled.
        issueAuthCookie(res, user.id, user.authVersion ?? 0);
        res.redirect(`${env.CLIENT_URL}/dashboard`);
      }
    )(req, res, next);
  }
);

/** @openapi
 * /api/auth/me:
 *   get:
 *     summary: Get profile data for the authenticated user
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       '200':
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       '401': { description: Unauthorized }
 */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user!.id,
    email: req.user!.email,
    name: req.user!.name,
    avatar: req.user!.avatar,
  });
});

/** @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Sign out and clear session cookies
 *     responses:
 *       '204': { description: Session cleared }
 */
authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  });

  res.clearCookie('2fa_challenge', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  });

  res.status(204).end();
});
