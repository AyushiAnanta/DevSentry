import { api } from './client';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  hasPassword?: boolean;
}

export interface ForgotPasswordResponse {
  message: string;
  devResetUrl?: string;
}

export interface MessageResponse {
  message: string;
  hasPassword?: boolean;
}

export interface AuthProvidersResponse {
  google: boolean;
  emailPassword: boolean;
}

export async function getAuthProviders(): Promise<AuthProvidersResponse> {
  return (await api.get<AuthProvidersResponse>('/auth/providers')).data;
}

export async function getMe(): Promise<User> {
  return (await api.get<User>('/auth/me')).data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function register(name: string, email: string, password: string): Promise<User> {
  return (await api.post<User>('/auth/register', { name, email, password })).data;
}

export async function login(email: string, password: string): Promise<User> {
  return (await api.post<User>('/auth/login', { email, password })).data;
}

export async function forgotPassword(email: string): Promise<ForgotPasswordResponse> {
  return (await api.post<ForgotPasswordResponse>('/auth/forgot-password', { email })).data;
}

export async function resetPassword(token: string, password: string): Promise<MessageResponse> {
  return (await api.post<MessageResponse>('/auth/reset-password', { token, password })).data;
}

export async function changePassword(
  newPassword: string,
  currentPassword?: string
): Promise<MessageResponse> {
  return (
    await api.post<MessageResponse>('/auth/change-password', {
      ...(currentPassword !== undefined ? { currentPassword } : {}),
      newPassword,
    })
  ).data;
}
