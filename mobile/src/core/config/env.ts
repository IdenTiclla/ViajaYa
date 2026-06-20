/**
 * Acceso tipado a la configuración de `extra` (app.config.ts) vía expo-constants.
 */
import Constants from 'expo-constants';

type Extra = {
  apiUrl: string;
  googleMapsApiKey: string;
  googleClientIds: { ios: string; android: string; web: string };
  facebookAppId: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

const apiUrl = extra.apiUrl ?? 'http://localhost:8000/api/v1';

/** Deriva la URL del WebSocket del `apiUrl` (http→ws, https→wss). */
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http(s?):\/\//i, (_match, secure) => `ws${secure}://`);
}

export const env = {
  apiUrl,
  /** Base del WebSocket (mismo host que la API); los sockets le añaden `/ws/...`. */
  wsUrl: toWsUrl(apiUrl),
  googleMapsApiKey: extra.googleMapsApiKey ?? '',
  googleClientIds: {
    ios: extra.googleClientIds?.ios ?? '',
    android: extra.googleClientIds?.android ?? '',
    web: extra.googleClientIds?.web ?? '',
  },
  facebookAppId: extra.facebookAppId ?? '',
} as const;
