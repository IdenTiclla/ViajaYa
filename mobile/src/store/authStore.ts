/**
 * Estado global de sesión (zustand).
 *
 * Orquesta el repositorio de auth y la persistencia de tokens (SecureStore).
 * El acceso por teléfono y el social terminan en el mismo `acceptPhoneSession`.
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
  /** Replace the session user after a profile mutation (driver application, mode switch). */
  setUser: (user: User) => void;
};

export const useAuthStore = create<AuthState>((set) => {
  async function applySession(result: AuthResult): Promise<void> {
    const generation = ++generacionSesion;
    invalidarSolicitudesSesion();
    await tokenStorage.save(result.tokens);
    if (generation !== generacionSesion) return;
    set({ user: result.user, status: 'authenticated', startupError: null });
  }

  return {
    user: null,
    status: 'loading',
    startupError: null,
    acceptPhoneSession: applySession,
    setUser(user) {
      set((state) => (state.status === 'authenticated' ? { user } : {}));
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
        set({ user, status: user ? 'authenticated' : 'unauthenticated' });
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
          set({ user: null, status: 'unauthenticated', startupError: null });
        }
      }
    },
  };
});

// El cliente HTTP ya eliminó las credenciales. No duplicar el borrado nativo.
setOnSessionExpired(() => {
  generacionSesion += 1;
  useAuthStore.setState({ user: null, status: 'unauthenticated', startupError: null });
});
