/**
 * Validated access to public build configuration through expo-constants.
 */
import Constants from 'expo-constants';

import { parseRuntimeEnvironment } from './environment';

type Extra = {
  apiUrl: string;
  googleMapsApiKey: string;
  googleClientIds: { ios: string; android: string; web: string };
  facebookAppId: string;
  facebookClientToken: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra> & Record<string, unknown>;
const runtime = parseRuntimeEnvironment(extra);

const apiUrl = runtime.apiUrl;

/** Preserve the API origin and path when selecting the WebSocket transport. */
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http(s?):\/\//i, (_match, secure) => `ws${secure}://`);
}

export const env = {
  ...runtime,
  apiUrl,
  /** Sockets append /ws/... to the environment-specific API base. */
  wsUrl: toWsUrl(apiUrl),
  googleMapsApiKey: extra.googleMapsApiKey ?? '',
  googleClientIds: {
    ios: extra.googleClientIds?.ios ?? '',
    android: extra.googleClientIds?.android ?? '',
    web: extra.googleClientIds?.web ?? '',
  },
  facebookAppId: extra.facebookAppId ?? '',
  facebookClientToken: extra.facebookClientToken ?? '',
} as const;
