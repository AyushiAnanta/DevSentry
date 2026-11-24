import { api } from './client';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface AuthActionResponse {
  message: string;
  user?: User;
  requiresTwoFactor?: boolean;
}

export async function getMe(): Promise<User> {
  return (await api.get<User>('/auth/me')).data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<AuthActionResponse> {
  return (await api.post<AuthActionResponse>('/auth/login', { email, password })).data;
}

export async function registerWithEmail(
  name: string,
  email: string,
  password: string
): Promise<AuthActionResponse> {
  return (await api.post<AuthActionResponse>('/auth/register', { name, email, password })).data;
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return (await api.post<{ message: string }>('/auth/forgot-password', { email })).data;
}

export async function resetPassword(
  email: string,
  token: string,
  newPassword: string
): Promise<{ message: string }> {
  return (
    await api.post<{ message: string }>('/auth/reset-password', {
      email,
      token,
      newPassword,
    })
  ).data;
}
