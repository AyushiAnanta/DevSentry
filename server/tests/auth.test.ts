import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { User } from '../src/models/User';
import * as emailService from '../src/services/emailService';
import { hashPassword, hashResetToken } from '../src/services/passwordService';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  jest.restoreAllMocks();
});

describe('Password Auth & Reset Flow', () => {
  test('registers a new user, hashes password, issues cookie, and authenticates /me', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      password: 'Password123!',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      hasPassword: true,
    });
    expect(res.body.passwordHash).toBeUndefined();
    const setCookie = res.headers['set-cookie']?.[0];
    expect(setCookie).toContain('token=');

    const saved = await User.findOne({ email: 'ada@example.com' }).select('+passwordHash');
    expect(saved?.passwordHash).toBeTruthy();
    expect(saved?.passwordHash).not.toBe('Password123!');

    const me = await request(app).get('/api/auth/me').set('Cookie', setCookie!);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('ada@example.com');
    expect(me.body.hasPassword).toBe(true);
  });

  test('rejects duplicate email registration case-insensitively and invalid input', async () => {
    await User.create({ email: 'dup@example.com', name: 'Existing' });

    const duplicate = await request(app).post('/api/auth/register').send({
      name: 'Second User',
      email: 'DUP@example.com',
      password: 'Password123!',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_EXISTS');

    const invalid = await request(app).post('/api/auth/register').send({
      name: 'A',
      email: 'not-an-email',
      password: 'short',
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('logs in with valid credentials and rejects wrong password or Google-only users', async () => {
    const passwordHash = await hashPassword('CorrectPass1!');
    await User.create({ email: 'dev@example.com', name: 'Dev', passwordHash });
    await User.create({ googleId: 'g-123', email: 'oauth@example.com', name: 'OAuth User' });

    const badPass = await request(app).post('/api/auth/login').send({
      email: 'dev@example.com',
      password: 'WrongPassword',
    });
    expect(badPass.status).toBe(401);
    expect(badPass.body.error.code).toBe('INVALID_CREDENTIALS');

    const oauthOnly = await request(app).post('/api/auth/login').send({
      email: 'oauth@example.com',
      password: 'AnyPassword1!',
    });
    expect(oauthOnly.status).toBe(401);

    const ok = await request(app).post('/api/auth/login').send({
      email: 'DEV@example.com',
      password: 'CorrectPass1!',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe('dev@example.com');
    expect(ok.headers['set-cookie']?.[0]).toContain('token=');
  });

  test('forgot-password avoids email enumeration and stores hashed reset token', async () => {
    const sendSpy = jest.spyOn(emailService, 'sendPasswordResetEmail').mockResolvedValue({ delivered: true });

    const missing = await request(app).post('/api/auth/forgot-password').send({
      email: 'nobody@example.com',
    });
    expect(missing.status).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();

    await User.create({
      email: 'reset@example.com',
      name: 'Reset User',
      passwordHash: await hashPassword('OldPass123!'),
    });

    const found = await request(app).post('/api/auth/forgot-password').send({
      email: 'reset@example.com',
    });
    expect(found.status).toBe(200);
    expect(found.body.message).toContain('If an account with that email exists');
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const [, , resetUrl] = sendSpy.mock.calls[0];
    const token = new URL(resetUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    const userInDb = await User.findOne({ email: 'reset@example.com' }).select(
      '+resetPasswordTokenHash +resetPasswordExpiresAt'
    );
    expect(userInDb?.resetPasswordTokenHash).toBe(hashResetToken(token!));
    expect(userInDb?.resetPasswordTokenHash).not.toBe(token);
    expect(userInDb?.resetPasswordExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test('reset-password updates password, invalidates token reuse, and rejects expired tokens', async () => {
    const sendSpy = jest.spyOn(emailService, 'sendPasswordResetEmail').mockResolvedValue({ delivered: true });

    await User.create({
      email: 'grace@example.com',
      name: 'Grace',
      passwordHash: await hashPassword('InitialPass1!'),
    });

    await request(app).post('/api/auth/forgot-password').send({ email: 'grace@example.com' });
    const resetUrl = sendSpy.mock.calls[0][2];
    const token = new URL(resetUrl).searchParams.get('token')!;

    const resetRes = await request(app).post('/api/auth/reset-password').send({
      token,
      password: 'NewStrongPass9!',
    });
    expect(resetRes.status).toBe(200);

    // Token cannot be reused
    const reuseRes = await request(app).post('/api/auth/reset-password').send({
      token,
      password: 'AnotherPass9!',
    });
    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.error.code).toBe('INVALID_RESET_TOKEN');

    // Old password fails, new password succeeds
    expect(
      (await request(app).post('/api/auth/login').send({ email: 'grace@example.com', password: 'InitialPass1!' }))
        .status
    ).toBe(401);
    expect(
      (await request(app).post('/api/auth/login').send({ email: 'grace@example.com', password: 'NewStrongPass9!' }))
        .status
    ).toBe(200);

    // Expired token is rejected
    await User.updateOne(
      { email: 'grace@example.com' },
      {
        resetPasswordTokenHash: hashResetToken('expired-token-value-123456'),
        resetPasswordExpiresAt: new Date(Date.now() - 60_000),
      }
    );
    const expiredRes = await request(app).post('/api/auth/reset-password').send({
      token: 'expired-token-value-123456',
      password: 'NewStrongPass9!',
    });
    expect(expiredRes.status).toBe(400);
  });

  test('change-password enforces current password when present and allows Google-only users to set one', async () => {
    const googleUser = await User.create({
      googleId: 'google-only-1',
      email: 'googleuser@example.com',
      name: 'Google User',
    });
    const googleCookie = `token=${jwt.sign({ id: googleUser.id }, env.JWT_SECRET, { expiresIn: '7d' })}`;

    // Unauthenticated rejected
    expect(
      (await request(app).post('/api/auth/change-password').send({ newPassword: 'NewPassword1!' })).status
    ).toBe(401);

    // Google-only user can set an initial password without currentPassword
    const setRes = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', googleCookie)
      .send({ newPassword: 'FirstPassword1!' });
    expect(setRes.status).toBe(200);
    expect(setRes.body.hasPassword).toBe(true);

    // Now changing password requires correct currentPassword
    const missingCurrent = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', googleCookie)
      .send({ newPassword: 'SecondPassword2!' });
    expect(missingCurrent.status).toBe(400);

    const wrongCurrent = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', googleCookie)
      .send({ currentPassword: 'WrongPassword', newPassword: 'SecondPassword2!' });
    expect(wrongCurrent.status).toBe(401);

    const okChange = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', googleCookie)
      .send({ currentPassword: 'FirstPassword1!', newPassword: 'SecondPassword2!' });
    expect(okChange.status).toBe(200);

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'googleuser@example.com',
      password: 'SecondPassword2!',
    });
    expect(loginRes.status).toBe(200);
  });

  test('sendPasswordResetEmail uses SMTP when configured and falls back cleanly when unconfigured', async () => {
    const prevHost = env.SMTP_HOST;
    try {
      env.SMTP_HOST = '';
      const fallback = await emailService.sendPasswordResetEmail(
        'u@example.com',
        'User',
        'http://localhost:5173/reset-password?token=abc'
      );
      expect(fallback.delivered).toBe(false);

      const sendMail = jest.fn().mockResolvedValue({ messageId: 'msg-1' });
      const createTransportSpy = jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({ sendMail } as unknown as ReturnType<typeof nodemailer.createTransport>);

      env.SMTP_HOST = 'smtp.example.com';
      const sent = await emailService.sendPasswordResetEmail(
        'u@example.com',
        'User',
        'http://localhost:5173/reset-password?token=abc'
      );
      expect(sent.delivered).toBe(true);
      expect(createTransportSpy).toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'u@example.com',
          subject: 'Reset your DevSentry password',
        })
      );
    } finally {
      env.SMTP_HOST = prevHost;
    }
  });

  test('auth providers and unconfigured Google OAuth redirect HTML browsers cleanly', async () => {
    const prevId = env.GOOGLE_CLIENT_ID;
    const prevSecret = env.GOOGLE_CLIENT_SECRET;
    try {
      env.GOOGLE_CLIENT_ID = '';
      env.GOOGLE_CLIENT_SECRET = '';

      const providers = await request(app).get('/api/auth/providers');
      expect(providers.status).toBe(200);
      expect(providers.body).toEqual({ google: false, emailPassword: true });

      const htmlNav = await request(app)
        .get('/api/auth/google')
        .set('Accept', 'text/html,application/xhtml+xml');
      expect(htmlNav.status).toBe(302);
      expect(htmlNav.headers.location).toBe(`${env.CLIENT_URL}/login?error=oauth_unconfigured`);

      const apiCall = await request(app)
        .get('/api/auth/google')
        .set('Accept', 'application/json');
      expect(apiCall.status).toBe(501);
      expect(apiCall.body.error.code).toBe('OAUTH_UNCONFIGURED');
    } finally {
      env.GOOGLE_CLIENT_ID = prevId;
      env.GOOGLE_CLIENT_SECRET = prevSecret;
    }
  });
});
