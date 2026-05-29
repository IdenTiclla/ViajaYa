/**
 * Estado global de sesión (zustand).
 *
 * Orquesta el repositorio de auth y la persistencia de tokens (SecureStore).
 * El login local y el SSO (Fase 6) terminan en el mismo `setSession`.
 */
import { create } from 'zustand';

import { setOnSessionExpired } from '@/core/http/client';
import { tokenStorage } from '@/core/http/tokenStorage';
import { authRepository } from '@/features/auth/data/authRepository';
import type {
  AuthProvider,
  AuthResult,
  LoginPayload,
  RegisterPayload,
  User,
} from '@/features/auth/domain/types';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

type AuthState = {
  user: User | null;
  status: Status;
  bootstrap: () => Promise<void>;
  signIn: (payload: LoginPayload) => Promise<void>;
  signUp: (payload: RegisterPayload) => Promise<void>;
  signInWithOAuth: (provider: Exclude<AuthProvider, 'local'>, token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => {
  async function applySession(result: AuthResult): Promise<void> {
    await tokenStorage.save(result.tokens);
    set({ user: result.user, status: 'authenticated' });
  }

  return {
    user: null,
    status: 'loading',

    async bootstrap() {
      const tokens = await tokenStorage.get();
      if (!tokens) {
        set({ user: null, status: 'unauthenticated' });
        return;
      }
      try {
        const user = await authRepository.me();
        set({ user, status: 'authenticated' });
      } catch {
        await tokenStorage.clear();
        set({ user: null, status: 'unauthenticated' });
      }
    },

    async signIn(payload) {
      await applySession(await authRepository.login(payload));
    },

    async signUp(payload) {
      await applySession(await authRepository.register(payload));
    },

    async signInWithOAuth(provider, token) {
      await applySession(await authRepository.oauth(provider, token));
    },

    async signOut() {
      await tokenStorage.clear();
      set({ user: null, status: 'unauthenticated' });
    },
  };
});

// Si el refresco de token falla (sesión expirada), el cliente HTTP cierra sesión.
setOnSessionExpired(() => {
  void useAuthStore.getState().signOut();
});
