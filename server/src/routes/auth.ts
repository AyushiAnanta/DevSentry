import { Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import passport from '../config/passport';
import { requireAuth } from '../middleware/requireAuth';
import { authLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { User } from '../models/User';
import { generateResetToken, hashPassword, hashResetToken, verifyPassword } from '../services/passwordService';
import { isSmtpConfigured, sendPasswordResetEmail } from '../services/emailService';

export const authRouter = Router();

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Enter a valid email address').transform(v => v.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').transform(v => v.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(128),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').transform(v => v.toLowerCase()),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(16, 'Invalid reset token').max(256),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
});

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
  };
}

function issueSessionCookie(res: Response, userId: string): void {
  const token = jwt.sign({ id: userId }, env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { ...cookieOptions(), maxAge: COOKIE_MAX_AGE_MS });
}

function serializeUser(user: {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  hasPassword?: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    hasPassword: Boolean(user.hasPassword),
  };
}

/** @openapi
 * /api/auth/providers:
 *   get:
 *     summary: List enabled authentication providers
 *     responses: { '200': { description: Enabled auth providers } }
 */
authRouter.get('/providers', (_req, res) => {
  res.json({
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    emailPassword: true,
  });
});

/** @openapi
 * /api/auth/google:
 *   get:
 *     summary: Begin Google OAuth sign-in
 *     responses: { '302': { description: Redirect to Google } }
 */
authRouter.get('/google', authLimiter, (req, res, next) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    if (req.accepts(['html', 'json']) === 'html') {
      res.redirect(`${env.CLIENT_URL.replace(/\/$/, '')}/login?error=oauth_unconfigured`);
      return;
    }
    res.status(501).json({ error: { code: 'OAUTH_UNCONFIGURED', message: 'Google OAuth is not configured' } });
    return;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

/** @openapi
 * /api/auth/google/callback:
 *   get:
 *     summary: Complete Google OAuth and issue cookie
 *     responses: { '302': { description: Redirect to dashboard or landing page } }
 */
authRouter.get('/google/callback', authLimiter, (req, res, next) => {
  passport.authenticate('google', { session: false }, (error: Error | null, user: { id: string } | false) => {
    if (error || !user) {
      res.redirect(`${env.CLIENT_URL}/?error=auth_failed`);
      return;
    }
    issueSessionCookie(res, user.id);
    res.redirect(`${env.CLIENT_URL}/dashboard`);
  })(req, res, next);
});

/** @openapi
 * /api/auth/register:
 *   post:
 *     summary: Create an email/password account and sign in
 *     responses: { '201': { description: Account created }, '409': { description: Email already registered } }
 */
authRouter.post('/register', authLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body as z.infer<typeof registerSchema>;
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(409).json({
        error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' },
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ name, email, passwordHash });
    issueSessionCookie(res, user.id);
    res.status(201).json(
      serializeUser({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        hasPassword: true,
      })
    );
  } catch (error) {
    next(error);
  }
});

/** @openapi
 * /api/auth/login:
 *   post:
 *     summary: Sign in with email and password
 *     responses: { '200': { description: Signed in }, '401': { description: Invalid credentials } }
 */
authRouter.post('/login', authLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !user.passwordHash) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    issueSessionCookie(res, user.id);
    res.json(
      serializeUser({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        hasPassword: true,
      })
    );
  } catch (error) {
    next(error);
  }
});

/** @openapi
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request a password reset email
 *     responses: { '200': { description: Reset email queued if account exists } }
 */
authRouter.post('/forgot-password', authLimiter, validateBody(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { email } = req.body as z.infer<typeof forgotPasswordSchema>;
    const genericMessage = 'If an account with that email exists, a password reset link has been sent.';
    const user = await User.findOne({ email }).select('+resetPasswordTokenHash +resetPasswordExpiresAt');

    if (!user) {
      res.json({ message: genericMessage });
      return;
    }

    const { token, tokenHash } = generateResetToken();
    user.resetPasswordTokenHash = tokenHash;
    user.resetPasswordExpiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000);
    await user.save();

    const resetUrl = `${env.CLIENT_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    const result = await sendPasswordResetEmail(user.email, user.name, resetUrl);

    if (env.NODE_ENV === 'development' && !result.delivered && !isSmtpConfigured()) {
      res.json({ message: genericMessage, devResetUrl: resetUrl });
      return;
    }

    res.json({ message: genericMessage });
  } catch (error) {
    next(error);
  }
});

/** @openapi
 * /api/auth/reset-password:
 *   post:
 *     summary: Complete a password reset using a valid reset token
 *     responses: { '200': { description: Password updated }, '400': { description: Invalid or expired token } }
 */
authRouter.post('/reset-password', authLimiter, validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body as z.infer<typeof resetPasswordSchema>;
    const tokenHash = hashResetToken(token);

    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() },
    }).select('+resetPasswordTokenHash +resetPasswordExpiresAt +passwordHash');

    if (!user) {
      res.status(400).json({
        error: { code: 'INVALID_RESET_TOKEN', message: 'Reset link is invalid or has expired' },
      });
      return;
    }

    user.passwordHash = await hashPassword(password);
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordExpiresAt = undefined;
    await user.save();

    res.clearCookie('token', cookieOptions());
    res.json({ message: 'Password has been reset successfully. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

/** @openapi
 * /api/auth/change-password:
 *   post:
 *     summary: Set or change password for the signed-in user
 *     security: [{ cookieAuth: [] }]
 *     responses: { '200': { description: Password updated }, '401': { description: Incorrect current password } }
 */
authRouter.post('/change-password', authLimiter, requireAuth, validateBody(changePasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await User.findById(req.user!.id).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');

    if (!user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Current password is required' },
        });
        return;
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({
          error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' },
        });
        return;
      }
    }

    user.passwordHash = await hashPassword(newPassword);
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordExpiresAt = undefined;
    await user.save();

    res.json({ message: 'Password updated successfully', hasPassword: true });
  } catch (error) {
    next(error);
  }
});

/** @openapi
 * /api/auth/me:
 *   get:
 *     summary: Get current user
 *     security: [{ cookieAuth: [] }]
 *     responses: { '200': { description: User profile }, '401': { description: Not authenticated } }
 */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json(serializeUser(req.user!));
});

/** @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Clear authentication cookie
 *     responses: { '204': { description: Logged out } }
 */
authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token', cookieOptions());
  res.status(204).end();
});
