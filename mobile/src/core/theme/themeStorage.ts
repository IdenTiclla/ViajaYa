import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ThemeStorage } from './createThemeStore';

const KEY = 'viajaya.tema';

/** Reuse the installed native storage; on web only this preference is stored. */
export const themeStorage: ThemeStorage = {
  async read() {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    }
    return SecureStore.getItemAsync(KEY);
  },
  async save(mode) {
    if (Platform.OS === 'web') {
      localStorage.setItem(KEY, mode);
      return;
    }
    await SecureStore.setItemAsync(KEY, mode);
  },
};
