
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

import { env } from '../config/env';
import { User } from '../models/User';

// Attach authenticated identity to Express requests.
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      avatar?: string;
      twoFactorEnabled?: boolean;
      authVersion?: number;
    }
  }
}

interface AuthTokenPayload {
  id?: string;
  purpose?: string;
  authVersion?: number;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.token as string | undefined;

    if (!token) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const payload = jwt.verify(
      token,
      env.JWT_SECRET
    ) as AuthTokenPayload;

    // Reject temporary 2FA challenge tokens.
    if (payload.purpose === '2fa-login') {
      res.status(401).json({
        error: {
          code: 'TWO_FACTOR_REQUIRED',
          message: 'Complete two-factor verification first',
        },
      });
      return;
    }

    if (
      !payload.id ||
      !Types.ObjectId.isValid(payload.id) ||
      typeof payload.authVersion !== 'number'
    ) {
      throw new Error('Invalid token payload');
    }

    const user = await User.findById(payload.id);

    if (!user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    // Invalidate sessions issued before a password/security change.
    if (payload.authVersion !== user.authVersion) {
      res.status(401).json({
        error: {
          code: 'SESSION_INVALIDATED',
          message: 'Your session is no longer valid. Please sign in again.',
        },
      });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      twoFactorEnabled: user.twoFactorEnabled,
    };

    next();
  } catch {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }
}
