/**
 * Instancia axios única para la API de ViajaYa.
 *
 * - Interceptor de request: adjunta el access token (Bearer).
 * - Interceptor de response: ante un 401, intenta refrescar el token una vez y
 *   reintenta la petición original. Si el refresco falla, limpia la sesión y
 *   notifica al listener registrado (lo usa el authStore para cerrar sesión).
 */
import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { env } from '@/core/config/env';
import { tokenStorage } from '@/core/http/tokenStorage';

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let onSessionExpired: (() => void) | null = null;

/** El authStore registra aquí su `signOut` para reaccionar a sesiones expiradas. */
export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

// axios expone `create` como named export además del default; el lint avisa de
// una posible confusión, pero aquí el uso es intencional.
// eslint-disable-next-line import/no-named-as-default-member
export const api = axios.create({
  baseURL: env.apiUrl,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const tokens = await tokenStorage.get();
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

// Endpoints donde un 401 NO debe disparar refresh: el propio refresh (evita
// bucles) y los de credenciales (un 401 ahí es un fallo de auth real, no un
// token expirado). `/auth/me` sí debe poder refrescar (p. ej. al rehidratar
// la sesión con un access token vencido pero refresh válido).
const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/oauth'];

// Refresco compartido: si llegan varias 401 a la vez, esperan al mismo refresh.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const tokens = await tokenStorage.get();
  if (!tokens?.refreshToken) return null;
  try {
    const { data } = await axios.post(`${env.apiUrl}/auth/refresh`, {
      refresh_token: tokens.refreshToken,
    });
    await tokenStorage.save({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    });
    return data.access_token as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const skipRefresh = NO_REFRESH_PATHS.some((path) => original?.url?.includes(path));

    if (error.response?.status === 401 && original && !original._retry && !skipRefresh) {
      original._retry = true;
      refreshPromise = refreshPromise ?? refreshAccessToken();
      const newToken = await refreshPromise;
      refreshPromise = null;

      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original as AxiosRequestConfig);
      }
      await tokenStorage.clear();
      onSessionExpired?.();
    }
    return Promise.reject(error);
  },
);
