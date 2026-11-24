
import { model, Schema } from 'mongoose';

export interface UserRecord {
  googleId?: string;
  email: string;
  name: string;
  avatar?: string;

  // Password authentication
  passwordHash?: string;

  // Forgot password
  resetPasswordTokenHash?: string;
  resetPasswordExpires?: Date;

  // Two-factor authentication
  twoFactorEnabled: boolean;
  twoFactorSecretEncrypted?: string;
  pendingTwoFactorSecretEncrypted?: string;
  recoveryCodes: string[];

  // Session invalidation
  authVersion: number;
}

const schema = new Schema<UserRecord>(
  {
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
    },

    avatar: String,

    passwordHash: {
      type: String,
      select: false,
    },

    resetPasswordTokenHash: {
      type: String,
      select: false,
    },

    resetPasswordExpires: {
      type: Date,
      select: false,
    },

    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },

    twoFactorSecretEncrypted: {
      type: String,
      select: false,
    },

    pendingTwoFactorSecretEncrypted: {
      type: String,
      select: false,
    },

    recoveryCodes: {
      type: [String],
      select: false,
      default: [],
    },

    authVersion: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export const User = model<UserRecord>('User', schema);
