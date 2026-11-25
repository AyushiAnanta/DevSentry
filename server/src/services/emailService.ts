import nodemailer from 'nodemailer';
import { env } from '../config/env';

export interface ResetEmailResult {
  delivered: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSmtpConfigured(): boolean {
  return env.SMTP_HOST.trim().length > 0;
}

/** Send a password reset link via SMTP when configured, or log a safe dev fallback. */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string
): Promise<ResetEmailResult> {
  if (!isSmtpConfigured()) {
    if (env.NODE_ENV === 'development') {
      process.stdout.write(`[DevSentry Mail Fallback] Password reset link for ${to}: ${resetUrl}\n`);
    } else if (env.NODE_ENV === 'production') {
      process.stderr.write('[DevSentry Mail] SMTP_HOST is not configured; password reset email was not sent.\n');
    }
    return { delivered: false };
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER && env.SMTP_PASS
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
      : {}),
  });

  const safeName = escapeHtml(name || 'there');
  const safeUrl = escapeHtml(resetUrl);
  const ttlMinutes = env.PASSWORD_RESET_TTL_MINUTES;

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Reset your DevSentry password',
    text: [
      `Hi ${name || 'there'},`,
      '',
      `We received a request to reset your DevSentry password. Use the link below within ${ttlMinutes} minutes:`,
      resetUrl,
      '',
      'If you did not request a password reset, you can safely ignore this email.',
    ].join('\n'),
    html: [
      `<p>Hi ${safeName},</p>`,
      `<p>We received a request to reset your DevSentry password. Click the link below within ${ttlMinutes} minutes:</p>`,
      `<p><a href="${safeUrl}">Reset password</a></p>`,
      `<p>If the button does not work, copy and paste this URL into your browser:<br /><code>${safeUrl}</code></p>`,
      `<p>If you did not request a password reset, you can safely ignore this email.</p>`,
    ].join(''),
  });

  return { delivered: true };
}
