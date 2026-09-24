import { useStore } from 'zustand';

import { themeStorage } from './themeStorage';
import { createThemeStore } from './createThemeStore';

const themeStore = createThemeStore(themeStorage);

export function useThemePreference() {
  return useStore(themeStore);
}
