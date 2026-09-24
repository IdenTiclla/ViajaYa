import { createStore } from 'zustand/vanilla';

import { conTiempoLimite } from '../async/conTiempoLimite';
import { resolverModoTema, TEMA_PREDETERMINADO, type ModoTema } from './tokens';

export type AlmacenTema = {
  leer: () => Promise<string | null>;
  guardar: (modo: ModoTema) => Promise<void>;
};

type EstadoTema = {
  modo: ModoTema;
  cargado: boolean;
  guardando: boolean;
  error: string | null;
  cargar: () => Promise<void>;
  elegir: (modo: ModoTema) => Promise<void>;
};

/** Local preference: it does not depend on the session and is not cleared on sign-out. */
export function crearStoreTema(almacen: AlmacenTema) {
  let lectura: Promise<void> | null = null;
  let revision = 0;
  return createStore<EstadoTema>((set, get) => ({
    modo: TEMA_PREDETERMINADO,
    cargado: false,
    guardando: false,
    error: null,
    cargar: () => {
      if (get().cargado) return Promise.resolve();
      if (lectura) return lectura;
      const revisionInicial = revision;
      lectura = conTiempoLimite(almacen.leer(), 5_000, 'No pudimos leer el tema guardado.')
        .then((valor) => {
          if (revision === revisionInicial) set({ modo: resolverModoTema(valor) });
        })
        .catch(() => {
          if (revision === revisionInicial) {
            set({ error: 'No pudimos recuperar tu tema. Puedes volver a elegirlo aquí.' });
          }
        })
        .finally(() => { set({ cargado: true }); lectura = null; });
      return lectura;
    },
    elegir: async (modo) => {
      if (get().guardando) return;
      revision += 1;
      set({ modo, guardando: true, error: null });
      try {
        await almacen.guardar(modo);
      } catch {
        set({ error: 'El tema está aplicado, pero no pudimos guardarlo. Vuelve a intentarlo.' });
      } finally {
        set({ guardando: false, cargado: true });
      }
    },
  }));
}
