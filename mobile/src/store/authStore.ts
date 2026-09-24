/**
 * Global session state (zustand).
 *
 * Orchestrates the auth repository and token persistence (SecureStore).
 * Phone and social sign-in both end in the same `acceptPhoneSession`.
 */
import { create } from 'zustand';

import { conTiempoLimite } from '@/core/async/conTiempoLimite';
import { getApiErrorMessage } from '@/core/errors/apiError';
import { api, invalidarSolicitudesSesion, setOnSessionExpired } from '@/core/http/client';
import { tokenStorage } from '@/core/http/tokenStorage';
import { authRepository } from '@/features/auth/data/authRepository';
import type { AuthResult, User } from '@/features/auth/domain/types';

type Status = 'loading' | 'error' | 'authenticated' | 'unauthenticated';

let generacionSesion = 0;

type AuthState = {
  user: User | null;
  status: Status;
  startupError: string | null;
  bootstrap: () => Promise<void>;
  signOut: () => Promise<void>;
  acceptPhoneSession: (result: AuthResult) => Promise<void>;
  /** Replace the session user after a profile mutation (driver vehicles, mode switch). */
  setUser: (user: User) => void;
  /**
   * True right after signing in with an approved driver account: the app asks
   * whether to enter as passenger or driver (and with which vehicle) before routing.
   */
  modeChoicePending: boolean;
  resolveModeChoice: () => void;
};

export const useAuthStore = create<AuthState>((set) => {
  async function applySession(result: AuthResult): Promise<void> {
    const generation = ++generacionSesion;
    invalidarSolicitudesSesion();
    await tokenStorage.save(result.tokens);
    if (generation !== generacionSesion) return;
    set({
      user: result.user,
      status: 'authenticated',
      startupError: null,
      modeChoicePending: result.user.driverStatus === 'approved',
    });
  }

  return {
    user: null,
    status: 'loading',
    startupError: null,
    acceptPhoneSession: applySession,
    setUser(user) {
      set((state) => (state.status === 'authenticated' ? { user } : {}));
    },
    modeChoicePending: false,
    resolveModeChoice() {
      set({ modeChoicePending: false });
    },

    async bootstrap() {
      const generacion = ++generacionSesion;
      set({ status: 'loading', startupError: null });
      try {
        const restaurar = async () => {
          const tokens = await tokenStorage.get();
          return tokens ? authRepository.me() : null;
        };
        const user = await conTiempoLimite(
          restaurar(), 30_000, 'La sesión tardó demasiado en cargar. Vuelve a intentar.',
        );
        if (generacion !== generacionSesion) return;
        set({ user, status: user ? 'authenticated' : 'unauthenticated', modeChoicePending: false });
      } catch (error) {
        if (generacion !== generacionSesion) return;
        set({
          user: null,
          status: 'error',
          startupError: getApiErrorMessage(error,
            error instanceof Error ? error.message : 'No pudimos recuperar tu sesión.'),
        });
      }
    },

    async signOut() {
      const generacion = ++generacionSesion;
      invalidarSolicitudesSesion();
      try {
        const tokens = await tokenStorage.get().catch(() => null);
        if (tokens?.refreshToken) {
          // Logging out locally remains available when the API is unreachable.
          await api.post('/auth/logout', { refresh_token: tokens.refreshToken }, {
            skipAuth: true, timeout: 5_000,
          }).catch(() => {});
        }
        if (generacion !== generacionSesion) return;
        await tokenStorage.clear();
      } catch {
        // Un fallo nativo no debe impedir volver al formulario de acceso.
      } finally {
        if (generacion === generacionSesion) {
          set({ user: null, status: 'unauthenticated', startupError: null, modeChoicePending: false });
        }
      }
    },
  };
});

// The HTTP client already removed the credentials. Do not duplicate the native deletion.
setOnSessionExpired(() => {
  generacionSesion += 1;
  useAuthStore.setState({
    user: null, status: 'unauthenticated', startupError: null, modeChoicePending: false,
  });
});
