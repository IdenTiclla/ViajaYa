/**
 * Almacenamiento seguro de tokens (expo-secure-store).
 * Compartido por el cliente HTTP (refresco) y el authStore (sesión).
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'viajaya.accessToken';
const REFRESH_KEY = 'viajaya.refreshToken';

export type TokenPair = { accessToken: string; refreshToken: string };

export const tokenStorage = {
  async get(): Promise<TokenPair | null> {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  },

  async save({ accessToken, refreshToken }: TokenPair): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  },
};
