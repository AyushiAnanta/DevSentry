import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ForgotPasswordPage,
  LoginPage,
  PasswordSettingsSection,
  RegisterPage,
  ResetPasswordPage,
} from './AuthPages';
import {
  changePassword,
  forgotPassword,
  getAuthProviders,
  getMe,
  login,
  register,
  resetPassword,
} from '../../api/auth';

vi.mock('../../api/auth', () => ({
  getMe: vi.fn(),
  getAuthProviders: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
}));

function renderWithRouter(ui: React.ReactNode, initialEntry = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AuthPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMe).mockRejectedValue({ response: { status: 401 } });
    vi.mocked(getAuthProviders).mockResolvedValue({ google: true, emailPassword: true });
  });

  it('validates and submits LoginPage', async () => {
    vi.mocked(login).mockResolvedValue({
      id: 'u1',
      name: 'Alex',
      email: 'alex@example.com',
      hasPassword: true,
    });

    renderWithRouter(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
      </Routes>,
      '/login'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email and password.');

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('alex@example.com', 'Password123!'));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('validates password match on RegisterPage and creates account', async () => {
    vi.mocked(register).mockResolvedValue({
      id: 'u2',
      name: 'Ada',
      email: 'ada@example.com',
      hasPassword: true,
    });

    renderWithRouter(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
      </Routes>,
      '/register'
    );

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Different123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(register).toHaveBeenCalledWith('Ada', 'ada@example.com', 'Password123!'));
  });

  it('submits ForgotPasswordPage and displays confirmation & dev reset URL', async () => {
    vi.mocked(forgotPassword).mockResolvedValue({
      message: 'If an account with that email exists, a password reset link has been sent.',
      devResetUrl: 'http://localhost:5173/reset-password?token=dev-token-123',
    });

    renderWithRouter(<ForgotPasswordPage />, '/forgot-password');

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account with that email exists, a password reset link has been sent.'
    );
    expect(screen.getByText(/dev-token-123/)).toBeInTheDocument();
  });

  it('handles missing token and valid password reset on ResetPasswordPage', async () => {
    renderWithRouter(<ResetPasswordPage />, '/reset-password');
    expect(screen.getByRole('alert')).toHaveTextContent('missing a token');

    vi.mocked(resetPassword).mockResolvedValue({
      message: 'Password has been reset successfully. You can now sign in.',
    });

    renderWithRouter(<ResetPasswordPage />, '/reset-password?token=valid-reset-token-123456');

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewSecret123!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'NewSecret123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith('valid-reset-token-123456', 'NewSecret123!')
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password has been reset successfully.'
    );
  });

  it('supports setting and changing password in PasswordSettingsSection', async () => {
    vi.mocked(changePassword).mockResolvedValue({
      message: 'Password updated successfully',
      hasPassword: true,
    });

    renderWithRouter(<PasswordSettingsSection hasPassword={false} />);
    expect(screen.getByRole('heading', { name: 'Set a password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'StrongPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'StrongPass1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('StrongPass1!', undefined));
    expect(await screen.findByRole('status')).toHaveTextContent('Password updated successfully');
  });

  it('shows helpful banner on LoginPage when redirected with oauth_unconfigured', async () => {
    vi.mocked(getAuthProviders).mockResolvedValue({ google: false, emailPassword: true });
    renderWithRouter(<LoginPage />, '/login?error=oauth_unconfigured');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Google OAuth is not configured on this server yet'
    );
    expect(await screen.findByText(/Google OAuth is unavailable/i)).toBeInTheDocument();
  });
});
