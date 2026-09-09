import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { AlmacenTema } from './crearStoreTema';

const CLAVE = 'viajaya.tema';

/** Reutiliza el almacenamiento nativo instalado; web guarda solo esta preferencia. */
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
