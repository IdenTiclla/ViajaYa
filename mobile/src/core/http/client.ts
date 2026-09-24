/**
 * Single axios instance for the ViajaYa API.
 *
 * - Request interceptor: attaches the access token (Bearer).
 * - Response interceptor: on a 401, tries to refresh the token once and
 *   retries the original request. If the server rejects the renewal,
 *   it clears the session; transient failures allow retrying.
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

type RetriableConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _generacionSesion?: number;
};

let generacionSesion = 0;

/** Discard pending responses when signing out or starting another session. */
export function invalidarSolicitudesSesion(): void {
  generacionSesion += 1;
  refreshPromise = null;
}

let onSessionExpired: (() => void) | null = null;

/** The authStore registers here the local transition for an expired session. */
export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

// axios exposes `create` as a named export besides the default; lint warns about
// a possible confusion, but the usage here is intentional.
// eslint-disable-next-line import/no-named-as-default-member
export const api = axios.create({
  baseURL: env.apiUrl,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  // Include the environment on login and refresh as well as authenticated requests.
  config.headers.set('X-App-Environment', env.appEnv);
  (config as RetriableConfig)._generacionSesion ??= generacionSesion;
  if (config.skipAuth) return config;
  const tokens = await tokenStorage.get();
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

// Endpoints where a 401 must NOT trigger a refresh: the refresh itself (avoids
// loops) and the credential ones (a 401 there is a real auth failure, not an
// expired token). `/auth/me` must be able to refresh (e.g. when rehydrating
// the session with an expired access token but a valid refresh token).
const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/phone/', '/auth/social/'];

// Shared refresh: if several 401s arrive at once, they wait for the same refresh.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const generacion = generacionSesion;
  const tokens = await tokenStorage.prepareRefresh();
  if (generacion !== generacionSesion) return null;
  if (!tokens?.refreshToken) return null;
  try {
    // Shares the client's timeout. skipAuth avoids attaching the expired token
    // and keeps the refresh from trying to renew itself on a 401.
    const { data } = await api.post('/auth/refresh', {
      refresh_token: tokens.refreshToken,
      request_id: tokens.refreshRequestId,
    }, { skipAuth: true });
    if (generacion !== generacionSesion) return null;
    await tokenStorage.save({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    });
    if (generacion !== generacionSesion) return null;
    return data.access_token as string;
  } catch (error) {
    // A network/server outage does not prove the session expired.
    // eslint-disable-next-line import/no-named-as-default-member
    if (axios.isAxiosError(error) && error.response?.status === 401) return null;
    throw error;
  }
}

async function cerrarSesionInvalida(): Promise<void> {
  invalidarSolicitudesSesion();
  const generacion = generacionSesion;
  try {
    await tokenStorage.clear();
  } finally {
    if (generacion === generacionSesion) onSessionExpired?.();
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const skipRefresh =
      original?.skipAuth || NO_REFRESH_PATHS.some((path) => original?.url?.includes(path));

    if (original?._generacionSesion !== generacionSesion) return Promise.reject(error);

    // If even the renewed token gets a 401, the identity is no longer valid.
    if (error.response?.status === 401 && original?._retry && !skipRefresh) {
      await cerrarSesionInvalida();
      return Promise.reject(error);
    }

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

      if (original._generacionSesion !== generacionSesion) return Promise.reject(error);

      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original as AxiosRequestConfig);
      }
      await cerrarSesionInvalida();
    }
    return Promise.reject(error);
  },
);
