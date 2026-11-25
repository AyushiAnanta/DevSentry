import { model, Schema } from 'mongoose';

export interface UserRecord {
  googleId?: string;
  email: string;
  name: string;
  avatar?: string;
  passwordHash?: string;
  resetPasswordTokenHash?: string;
  resetPasswordExpiresAt?: Date;
}

const schema = new Schema<UserRecord>(
  {
    googleId: { type: String, unique: true, sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    avatar: String,
    passwordHash: { type: String, select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
  },
  { timestamps: true }
);

export const User = model<UserRecord>('User', schema);
