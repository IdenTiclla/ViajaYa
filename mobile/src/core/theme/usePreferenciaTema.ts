import { useStore } from 'zustand';

import { themeStorage } from './almacenTema';
import { createThemeStore } from './crearStoreTema';

const themeStore = createThemeStore(themeStorage);

export function useThemePreference() {
  return useStore(themeStore);
}
