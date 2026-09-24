import { createStore } from 'zustand/vanilla';

import { withTimeout } from '../async/conTiempoLimite';
import { resolveThemeMode, DEFAULT_THEME_MODE, type ThemeMode } from './tokens';

export type ThemeStorage = {
  read: () => Promise<string | null>;
  save: (mode: ThemeMode) => Promise<void>;
};

type ThemeState = {
  mode: ThemeMode;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  choose: (mode: ThemeMode) => Promise<void>;
};

/** Local preference: it does not depend on the session and is not cleared on sign-out. */
export function createThemeStore(storage: ThemeStorage) {
  let reading: Promise<void> | null = null;
  let revision = 0;
  return createStore<ThemeState>((set, get) => ({
    mode: DEFAULT_THEME_MODE,
    loaded: false,
    saving: false,
    error: null,
    load: () => {
      if (get().loaded) return Promise.resolve();
      if (reading) return reading;
      const initialCheck = revision;
      reading = withTimeout(storage.read(), 5_000, 'No pudimos leer el tema guardado.')
        .then((valor) => {
          if (revision === initialCheck) set({ mode: resolveThemeMode(valor) });
        })
        .catch(() => {
          if (revision === initialCheck) {
            set({ error: 'No pudimos recuperar tu tema. Puedes volver a elegirlo aquí.' });
          }
        })
        .finally(() => { set({ loaded: true }); reading = null; });
      return reading;
    },
    choose: async (mode) => {
      if (get().saving) return;
      revision += 1;
      set({ mode, saving: true, error: null });
      try {
        await storage.save(mode);
      } catch {
        set({ error: 'El tema está aplicado, pero no pudimos guardarlo. Vuelve a intentarlo.' });
      } finally {
        set({ saving: false, loaded: true });
      }
    },
  }));
}
