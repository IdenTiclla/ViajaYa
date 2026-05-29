/** Implementación HTTP del puerto `AuthRepository` (usa el cliente axios único). */
import { api } from '@/core/http/client';
import type {
  AuthProvider,
  AuthRepository,
  AuthResult,
  LoginPayload,
  RegisterPayload,
  User,
} from '@/features/auth/domain/types';

import { type AuthResponseDto, toAuthResult, toUser } from './mappers';

export const authRepository: AuthRepository = {
  async register(payload: RegisterPayload): Promise<AuthResult> {
    const { data } = await api.post<AuthResponseDto>('/auth/register', {
      full_name: payload.fullName,
      email: payload.email,
      password: payload.password,
      phone: payload.phone,
    });
    return toAuthResult(data);
  },

  async login(payload: LoginPayload): Promise<AuthResult> {
    const { data } = await api.post<AuthResponseDto>('/auth/login', {
      email: payload.email,
      password: payload.password,
    });
    return toAuthResult(data);
  },

  async oauth(provider: Exclude<AuthProvider, 'local'>, token: string): Promise<AuthResult> {
    const { data } = await api.post<AuthResponseDto>(`/auth/oauth/${provider}`, { token });
    return toAuthResult(data);
  },

  async me(): Promise<User> {
    const { data } = await api.get('/auth/me');
    return toUser(data);
  },
};
