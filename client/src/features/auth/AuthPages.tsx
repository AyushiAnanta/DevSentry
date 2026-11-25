import { useState } from 'react';
import type React from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  changePassword,
  forgotPassword,
  getAuthProviders,
  login,
  register,
  resetPassword,
} from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

function extractApiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
    if (message) return message;
  }
  return fallback;
}

function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      <header className="landing-nav">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <ShieldCheck />
          </span>
          dev<span className="brand-light">sentry</span>
        </Link>
        <Link to="/" className="button button-quiet">
          <ArrowLeft size={14} /> Home
        </Link>
      </header>
      <main className="auth-container">
        <section className="auth-card">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
        </section>
      </main>
    </div>
  );
}

function GoogleAuthDivider() {
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: getAuthProviders,
    retry: false,
  });
  return (
    <>
      <div className="auth-divider">
        <span>or</span>
      </div>
      {providers.data?.google === false ? (
        <p className="auth-oauth-note">
          Google OAuth is unavailable until <code>GOOGLE_CLIENT_ID</code> and{' '}
          <code>GOOGLE_CLIENT_SECRET</code> are configured.
        </p>
      ) : (
        <a className="button button-quiet auth-google" href={`${API_BASE}/auth/google`}>
          Continue with Google
        </a>
      )}
    </>
  );
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const oauthUnconfigured = searchParams.get('error') === 'oauth_unconfigured';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');

  const mutation = useMutation({
    mutationFn: () => login(email.trim(), password),
    onSuccess: (user) => {
      qc.setQueryData(['auth'], user);
      toast.success('Signed in');
      navigate('/dashboard', { replace: true });
    },
    onError: (error) => {
      setFormError(extractApiError(error, 'Could not sign in. Please try again.'));
    },
  });

  if (auth.data) return <Navigate to="/dashboard" replace />;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    setFormError('');
    mutation.mutate();
  }

  return (
    <AuthShell
      eyebrow="ACCOUNT ACCESS"
      title="Sign in to DevSentry"
      subtitle="Use your email and password, or continue with Google."
    >
      {oauthUnconfigured && (
        <div role="status" className="form-info">
          Google OAuth is not configured on this server yet. Sign in or create an account with
          email &amp; password below, or set <code>GOOGLE_CLIENT_ID</code> and{' '}
          <code>GOOGLE_CLIENT_SECRET</code> in <code>server/.env</code>.
        </div>
      )}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
          />
        </label>
        <div className="auth-inline-row">
          <Link to="/forgot-password" className="text-link">
            Forgot password?
          </Link>
        </div>
        {formError && (
          <div role="alert" className="form-error">
            {formError}
          </div>
        )}
        <button className="button button-primary auth-submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <GoogleAuthDivider />
      <p className="auth-footer-text">
        New to DevSentry? <Link to="/register">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');

  const mutation = useMutation({
    mutationFn: () => register(name.trim(), email.trim(), password),
    onSuccess: (user) => {
      qc.setQueryData(['auth'], user);
      toast.success('Account created');
      navigate('/dashboard', { replace: true });
    },
    onError: (error) => {
      setFormError(extractApiError(error, 'Could not create account. Please try again.'));
    },
  });

  if (auth.data) return <Navigate to="/dashboard" replace />;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setFormError('Enter your name (at least 2 characters).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    setFormError('');
    mutation.mutate();
  }

  return (
    <AuthShell
      eyebrow="GET STARTED"
      title="Create your account"
      subtitle="Track repository defect risk and scan snippets in minutes."
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label>
          Full name
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Rivera"
          />
        </label>
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
          />
        </label>
        {formError && (
          <div role="alert" className="form-error">
            {formError}
          </div>
        )}
        <button className="button button-primary auth-submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <GoogleAuthDivider />
      <p className="auth-footer-text">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [devResetUrl, setDevResetUrl] = useState('');

  const mutation = useMutation({
    mutationFn: () => forgotPassword(email.trim()),
    onSuccess: (data) => {
      setSubmittedMessage(data.message);
      setDevResetUrl(data.devResetUrl ?? '');
    },
    onError: (error) => {
      setFormError(extractApiError(error, 'Could not process request. Please try again.'));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }
    setFormError('');
    setSubmittedMessage('');
    setDevResetUrl('');
    mutation.mutate();
  }

  return (
    <AuthShell
      eyebrow="PASSWORD RECOVERY"
      title="Forgot your password?"
      subtitle="Enter your account email and we will send you a link to set a new password."
    >
      {submittedMessage ? (
        <div className="auth-status-box" role="status">
          <div className="auth-status-icon">
            <Mail size={18} />
          </div>
          <p>{submittedMessage}</p>
          {devResetUrl && (
            <div className="dev-reset-box">
              <span>SMTP is not configured locally. Dev reset link:</span>
              <a href={devResetUrl}>{devResetUrl}</a>
            </div>
          )}
          <Link to="/login" className="button button-primary auth-submit">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {formError && (
            <div role="alert" className="form-error">
              {formError}
            </div>
          )}
          <button className="button button-primary auth-submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Sending reset link…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="auth-footer-text">
        Remembered your password? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [doneMessage, setDoneMessage] = useState('');

  const mutation = useMutation({
    mutationFn: () => resetPassword(token, password),
    onSuccess: (data) => {
      setDoneMessage(data.message);
      toast.success('Password reset successfully');
    },
    onError: (error) => {
      setFormError(extractApiError(error, 'Reset link is invalid or has expired.'));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setFormError('Reset token is missing. Request a new password reset link.');
      return;
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    setFormError('');
    mutation.mutate();
  }

  return (
    <AuthShell
      eyebrow="CHOOSE A NEW PASSWORD"
      title="Reset password"
      subtitle="Enter a new password for your DevSentry account."
    >
      {doneMessage ? (
        <div className="auth-status-box" role="status">
          <div className="auth-status-icon">
            <KeyRound size={18} />
          </div>
          <p>{doneMessage}</p>
          <Link to="/login" className="button button-primary auth-submit">
            Sign in with new password
          </Link>
        </div>
      ) : !token ? (
        <div className="auth-status-box">
          <div role="alert" className="form-error">
            This password reset link is missing a token or is malformed.
          </div>
          <Link to="/forgot-password" className="button button-primary auth-submit">
            Request a new reset link
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
          </label>
          {formError && (
            <div role="alert" className="form-error">
              {formError}
            </div>
          )}
          <button className="button button-primary auth-submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Updating password…' : 'Update password'}
          </button>
        </form>
      )}
      <p className="auth-footer-text">
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

export function PasswordSettingsSection({ hasPassword }: { hasPassword: boolean }) {
  const qc = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      changePassword(newPassword, hasPassword ? currentPassword : undefined),
    onSuccess: (data) => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setFormError('');
      setSuccessMsg(data.message);
      void qc.invalidateQueries({ queryKey: ['auth'] });
      toast.success(data.message);
    },
    onError: (error) => {
      setSuccessMsg('');
      setFormError(extractApiError(error, 'Could not update password.'));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccessMsg('');
    if (hasPassword && !currentPassword) {
      setFormError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setFormError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('New passwords do not match.');
      return;
    }
    setFormError('');
    mutation.mutate();
  }

  return (
    <section className="panel settings-card settings-password-card">
      <div className="settings-title">
        <span className="settings-avatar">
          <KeyRound size={18} />
        </span>
        <div>
          <h2>{hasPassword ? 'Change password' : 'Set a password'}</h2>
          <p>
            {hasPassword
              ? 'Update your email/password sign-in credentials.'
              : 'Add a password so you can also sign in with your email address.'}
          </p>
        </div>
      </div>
      <form className="auth-form settings-password-form" onSubmit={handleSubmit} noValidate>
        {hasPassword && (
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </label>
        )}
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
          />
        </label>
        {formError && (
          <div role="alert" className="form-error">
            {formError}
          </div>
        )}
        {successMsg && (
          <div role="status" className="form-success">
            {successMsg}
          </div>
        )}
        <div className="settings-password-actions">
          <button className="button button-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? 'Saving…'
              : hasPassword
                ? 'Update password'
                : 'Set password'}
          </button>
          <Link to="/forgot-password" className="text-link">
            Reset via email instead
          </Link>
        </div>
      </form>
    </section>
  );
}
