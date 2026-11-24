import { useState } from 'react';
import type React from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  forgotPassword,
  loginWithEmail,
  registerWithEmail,
  resetPassword,
} from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';

function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (
    error as { response?: { data?: { message?: string; error?: { message?: string } } } }
  )?.response?.data;
  return data?.error?.message ?? data?.message ?? fallback;
}

function googleAuthUrl(): string {
  return `${import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'}/auth/google`;
}

export function LoginPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>(
    params.get('mode') === 'register' ? 'register' : 'login'
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [issue, setIssue] = useState('');

  if (auth.data) {
    return <Navigate to="/dashboard" replace />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (mode === 'register' && !name.trim()) {
      setIssue('Enter your name');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setIssue('Enter a valid email address');
      return;
    }
    if (mode === 'register' && password.length < 8) {
      setIssue('Password must be at least 8 characters');
      return;
    }
    if (!password) {
      setIssue('Enter your password');
      return;
    }

    setIssue('');
    setSubmitting(true);
    try {
      const res =
        mode === 'register'
          ? await registerWithEmail(name.trim(), cleanEmail, password)
          : await loginWithEmail(cleanEmail, password);

      if (res.requiresTwoFactor) {
        toast.info('Two-factor verification required.');
        return;
      }

      await qc.invalidateQueries({ queryKey: ['auth'] });
      toast.success(mode === 'register' ? 'Account created' : 'Signed in');
      navigate('/dashboard');
    } catch (error) {
      setIssue(
        apiErrorMessage(
          error,
          mode === 'register' ? 'Could not create account.' : 'Could not sign in.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card modal">
        <Link to="/" className="brand auth-brand">
          <span className="brand-mark">
            <ShieldCheck size={20} />
          </span>
          <span>
            dev<span className="brand-light">sentry</span>
          </span>
        </Link>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login');
              setIssue('');
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register');
              setIssue('');
            }}
          >
            Create account
          </button>
        </div>

        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <p>
          {mode === 'login'
            ? 'Sign in with your DevSentry email and password.'
            : 'Register an email/password account to get started.'}
        </p>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Full name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </label>

          {mode === 'login' && (
            <div className="auth-inline-row">
              <Link to="/forgot-password" className="text-link">
                Forgot password?
              </Link>
            </div>
          )}

          {issue && (
            <div role="alert" className="form-error">
              {issue}
            </div>
          )}

          <button
            type="submit"
            className="button button-primary auth-submit"
            disabled={submitting}
          >
            {submitting
              ? mode === 'register'
                ? 'Creating account…'
                : 'Signing in…'
              : mode === 'register'
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <a className="button button-quiet auth-submit" href={googleAuthUrl()}>
          Continue with Google
        </a>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [issue, setIssue] = useState('');
  const [sentMessage, setSentMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setIssue('Enter a valid email address');
      return;
    }

    setIssue('');
    setSubmitting(true);
    try {
      const res = await forgotPassword(cleanEmail);
      setSentMessage(
        res.message ||
          'If an account exists for this email, a password reset link will be sent.'
      );
      toast.success('Reset email requested');
    } catch (error) {
      setIssue(apiErrorMessage(error, 'Could not process password reset request.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card modal">
        <Link to="/" className="brand auth-brand">
          <span className="brand-mark">
            <ShieldCheck size={20} />
          </span>
          <span>
            dev<span className="brand-light">sentry</span>
          </span>
        </Link>

        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h2>Forgot password</h2>
        <p>
          Enter the email for your email/password account and we’ll send a reset link
          (valid for 15 minutes).
        </p>

        {sentMessage ? (
          <div className="form-success" role="status">
            <strong>Check your inbox</strong>
            <p>{sentMessage}</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </label>

            {issue && (
              <div role="alert" className="form-error">
                {issue}
              </div>
            )}

            <button
              type="submit"
              className="button button-primary auth-submit"
              disabled={submitting}
            >
              {submitting ? 'Sending link…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="auth-footer-links">
          <Link to="/login" className="text-link">
            ← Back to sign in
          </Link>
          <Link to="/" className="text-link">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [token, setToken] = useState(params.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [issue, setIssue] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setIssue('Enter a valid email address');
      return;
    }
    if (!token.trim()) {
      setIssue('Reset token is missing. Open the link from your email.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setIssue('Password must be between 8 and 128 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setIssue('Passwords do not match');
      return;
    }

    setIssue('');
    setSubmitting(true);
    try {
      await resetPassword(email.trim(), token.trim(), newPassword);
      setDone(true);
      toast.success('Password updated. Please sign in.');
    } catch (error) {
      setIssue(apiErrorMessage(error, 'Could not reset password.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card modal">
        <Link to="/" className="brand auth-brand">
          <span className="brand-mark">
            <ShieldCheck size={20} />
          </span>
          <span>
            dev<span className="brand-light">sentry</span>
          </span>
        </Link>

        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h2>Reset password</h2>
        <p>Choose a new password for your DevSentry account.</p>

        {done ? (
          <>
            <div className="form-success" role="status">
              <strong>Password updated</strong>
              <p>You can now sign in with your new password.</p>
            </div>
            <button
              type="button"
              className="button button-primary auth-submit"
              onClick={() => navigate('/login')}
            >
              Go to sign in
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {!params.get('token') && (
              <label>
                Reset token
                <input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste reset token"
                />
              </label>
            )}
            <label>
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
              />
            </label>

            {issue && (
              <div role="alert" className="form-error">
                {issue}
              </div>
            )}

            <button
              type="submit"
              className="button button-primary auth-submit"
              disabled={submitting}
            >
              {submitting ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        )}

        <div className="auth-footer-links">
          <Link to="/login" className="text-link">
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
