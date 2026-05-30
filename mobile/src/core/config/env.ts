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

export const env = {
  apiUrl: extra.apiUrl ?? 'http://localhost:8000/api/v1',
  googleMapsApiKey: extra.googleMapsApiKey ?? '',
  googleClientIds: {
    ios: extra.googleClientIds?.ios ?? '',
    android: extra.googleClientIds?.android ?? '',
    web: extra.googleClientIds?.web ?? '',
  },
  facebookAppId: extra.facebookAppId ?? '',
} as const;
