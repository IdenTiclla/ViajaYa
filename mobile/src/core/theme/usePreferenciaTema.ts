import { useStore } from 'zustand';

import { almacenTema } from './almacenTema';
import { crearStoreTema } from './crearStoreTema';

const storeTema = crearStoreTema(almacenTema);

export function usePreferenciaTema() {
  return useStore(storeTema);
}
