
import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string
): Promise<void> {
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'DevSentry - Password Reset',
    text: `You requested a password reset for your DevSentry account.

Use this link to reset your password:
${resetUrl}

This link is valid for 15 minutes. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2>Reset Your DevSentry Password</h2>
        <p>We received a request to reset your password.</p>
        <p>
          <a href="${resetUrl}"
             style="background:#2563eb;color:white;padding:12px 20px;
             text-decoration:none;border-radius:6px;display:inline-block;">
            Reset Password
          </a>
        </p>
        <p>This link expires in 15 minutes.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}
