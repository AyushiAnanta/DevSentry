
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { User } from '../models/User';
import {
  requestPasswordReset,
  resetPassword,
} from '../services/passwordResetService';

/**
 * POST /api/auth/forgot-password
 */
export async function forgotPasswordController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const email =
      typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        error: {
          code: 'INVALID_EMAIL',
          message: 'Please provide a valid email address.',
        },
      });
      return;
    }

    await requestPasswordReset(email);

    // Same response whether the account exists or not.
    res.status(200).json({
      message:
        'If an account exists for this email, a password reset link will be sent.',
    });
  } catch (error) {
    req.log?.error?.(
      { error },
      'Password reset email request failed'
    );

    res.status(500).json({
      error: {
        code: 'PASSWORD_RESET_ERROR',
        message: 'Unable to process your request right now.',
      },
    });
  }
}

/**
 * POST /api/auth/reset-password
 */
export async function resetPasswordController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email, token, newPassword } = req.body ?? {};

    if (
      typeof email !== 'string' ||
      typeof token !== 'string' ||
      typeof newPassword !== 'string'
    ) {
      res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Email, reset token and new password are required.',
        },
      });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({
        error: {
          code: 'INVALID_EMAIL',
          message: 'Please provide a valid email address.',
        },
      });
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: 'Password must contain between 8 and 128 characters.',
        },
      });
      return;
    }

    const success = await resetPassword(
      email,
      token,
      newPassword
    );

    if (!success) {
      res.status(400).json({
        error: {
          code: 'INVALID_OR_EXPIRED_TOKEN',
          message: 'The password reset link is invalid or has expired.',
        },
      });
      return;
    }

    res.status(200).json({
      message: 'Password has been reset successfully. Please sign in again.',
    });
  } catch (error) {
    req.log?.error?.(
      { error },
      'Password reset failed'
    );

    res.status(500).json({
      error: {
        code: 'PASSWORD_RESET_ERROR',
        message: 'Unable to reset your password right now.',
      },
    });
  }
}

/**
 * Issue authentication cookie
 */
function issueLocalAuthCookie(
  res: Response,
  userId: string,
  authVersion: number
): void {
  const token = jwt.sign(
    { id: userId, authVersion },
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
 * Issue two-factor authentication challenge
 */
function issueTwoFactorChallenge(
  res: Response,
  userId: string
): void {
  const challengeToken = jwt.sign(
    { id: userId, purpose: '2fa-login' },
    env.JWT_SECRET,
    { expiresIn: '5m' }
  );

  // Do not leave an old authenticated session active.
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  });

  res.cookie('2fa_challenge', challengeToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 5 * 60 * 1000,
  });
}

/**
 * POST /api/auth/register
 */
export async function registerController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { name, email, password } = req.body ?? {};

    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      res.status(400).json({
        message: 'Name, email and password are required.',
      });
      return;
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (
      !normalizedName ||
      normalizedName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      res.status(400).json({
        message: 'Please provide a valid name and email address.',
      });
      return;
    }

    if (
      password.length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72
    ) {
      res.status(400).json({
        message: 'Password must be at least 8 characters and no more than 72 bytes.',
      });
      return;
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      res.status(409).json({
        message: 'An account with this email already exists.',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      twoFactorEnabled: false,
      recoveryCodes: [],
      authVersion: 0,
    });

    issueLocalAuthCookie(
      res,
      String(user._id),
      user.authVersion ?? 0
    );

    res.status(201).json({
      message: 'Account created successfully.',
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Registration failed:', error);

    res.status(500).json({
      message: 'Unable to create your account right now.',
    });
  }
}

/**
 * POST /api/auth/login
 */
export async function loginController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      !password
    ) {
      res.status(400).json({
        message: 'Email and password are required.',
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
    }).select('+passwordHash');

    // Use the same response for unknown emails and incorrect passwords.
    if (!user || !user.passwordHash) {
      res.status(401).json({
        message: 'Invalid email or password.',
      });
      return;
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      res.status(401).json({
        message: 'Invalid email or password.',
      });
      return;
    }

    // If 2FA is enabled, require OTP verification before login.
    if (user.twoFactorEnabled) {
      issueTwoFactorChallenge(res, String(user._id));

      res.status(200).json({
        message: 'Two-factor verification required.',
        requiresTwoFactor: true,
      });
      return;
    }

    issueLocalAuthCookie(
      res,
      String(user._id),
      user.authVersion ?? 0
    );

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Login failed:', error);

    res.status(500).json({
      message: 'Unable to log in right now.',
    });
  }
}
