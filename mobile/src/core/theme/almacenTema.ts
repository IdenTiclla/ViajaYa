import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { AlmacenTema } from './crearStoreTema';

const CLAVE = 'viajaya.tema';

/** Reuse the installed native storage; on web only this preference is stored. */
export const almacenTema: AlmacenTema = {
  async leer() {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(CLAVE);
    }
    return SecureStore.getItemAsync(CLAVE);
  },
  async guardar(modo) {
    if (Platform.OS === 'web') {
      localStorage.setItem(CLAVE, modo);
      return;
    }
    await SecureStore.setItemAsync(CLAVE, modo);
  },
};
