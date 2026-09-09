/**
 * Instancia axios única para la API de ViajaYa.
 *
 * - Interceptor de request: adjunta el access token (Bearer).
 * - Interceptor de response: ante un 401, intenta refrescar el token una vez y
 *   reintenta la petición original. Si el servidor rechaza la renovación,
 *   limpia la sesión; los fallos transitorios permiten reintentar.
 */
import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { env } from '@/core/config/env';
import { tokenStorage } from '@/core/http/tokenStorage';

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipAuth?: boolean;
  }

  export interface InternalAxiosRequestConfig {
    skipAuth?: boolean;
  }
}

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let onSessionExpired: (() => void) | null = null;

/** El authStore registra aquí la transición local ante una sesión expirada. */
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
  if (config.skipAuth) return config;
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
    // Comparte el timeout del cliente. skipAuth evita adjuntar el token vencido
    // y que el refresh intente renovarse a sí mismo ante un 401.
    const { data } = await api.post('/auth/refresh', {
      refresh_token: tokens.refreshToken,
    }, { skipAuth: true });
    await tokenStorage.save({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    });
    return data.access_token as string;
  } catch (error) {
    // Una caída de red/servidor no demuestra que la sesión haya vencido.
    // eslint-disable-next-line import/no-named-as-default-member
    if (axios.isAxiosError(error) && error.response?.status === 401) return null;
    throw error;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const skipRefresh =
      original?.skipAuth || NO_REFRESH_PATHS.some((path) => original?.url?.includes(path));

    if (error.response?.status === 401 && original && !original._retry && !skipRefresh) {
      original._retry = true;
      const pending = refreshPromise ?? refreshAccessToken();
      refreshPromise = pending;
      let newToken: string | null;
      try {
        newToken = await pending;
      } finally {
        // Un rechazo de SecureStore o HTTP no envenena los siguientes intentos.
        if (refreshPromise === pending) refreshPromise = null;
      }

      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original as AxiosRequestConfig);
      }
      try {
        await tokenStorage.clear();
      } finally {
        onSessionExpired?.();
      }
    }
    return Promise.reject(error);
  },
);
