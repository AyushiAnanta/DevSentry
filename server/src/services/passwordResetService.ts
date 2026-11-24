
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { User } from '../models/User';
import { env } from '../config/env';
import { sendPasswordResetEmail } from './emailService';

const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

/**
 * Hash a reset token before storing it in MongoDB.
 */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate and email a password-reset link.
 *
 * Always returns without revealing whether an account exists.
 */
export async function requestPasswordReset(
  email: string
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  // Password reset is only available for local password accounts.
  const user = await User.findOne({
    email: normalizedEmail,
  }).select('+passwordHash');

  // Google-only accounts do not have a local password to reset.
  if (!user || !user.passwordHash) {
    return;
  }

  // Generate a cryptographically secure random token.
  const resetToken = randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(resetToken);

  // Store only the hash and expiry.
  user.resetPasswordTokenHash = tokenHash;
  user.resetPasswordExpires = new Date(
    Date.now() + RESET_TOKEN_EXPIRY_MS
  );

  await user.save();

  // Send the original token only through the reset link.
  const resetUrl = new URL('/reset-password', env.CLIENT_URL);
  resetUrl.searchParams.set('token', resetToken);
  resetUrl.searchParams.set('email', normalizedEmail);

  try {
    await sendPasswordResetEmail(
      normalizedEmail,
      resetUrl.toString()
    );
  } catch (error) {
    // Invalidate the token if email delivery fails.
    await User.updateOne(
      {
        _id: user._id,
        resetPasswordTokenHash: tokenHash,
      },
      {
        $unset: {
          resetPasswordTokenHash: 1,
          resetPasswordExpires: 1,
        },
      }
    );

    throw error;
  }
}

/**
 * Verify the reset token and update the password.
 *
 * Returns false if the token is invalid or expired.
 */
export async function resetPassword(
  email: string,
  token: string,
  newPassword: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!token || !newPassword) {
    return false;
  }

  const tokenHash = hashResetToken(token);

  // Hash the new password before updating the account.
  const passwordHash = await bcrypt.hash(
    newPassword,
    BCRYPT_ROUNDS
  );

  // Atomic update: only a valid, unexpired token can succeed.
  const updatedUser = await User.findOneAndUpdate(
    {
      email: normalizedEmail,
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    },
    {
      $set: {
        passwordHash,
      },
      $inc: {
        authVersion: 1,
      },
      $unset: {
        resetPasswordTokenHash: 1,
        resetPasswordExpires: 1,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  return Boolean(updatedUser);
}
