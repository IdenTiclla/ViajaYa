import { createContext, useContext, useMemo } from 'react';

import { obtenerTema, TEMA_PREDETERMINADO, type Tema } from './tokens';

export const ContextoTema = createContext<Tema>(obtenerTema(TEMA_PREDETERMINADO));

export function useTema() {
  return useContext(ContextoTema);
}

/** Recalcula solo los estilos; cambiar de tema conserva pantallas y estado. */
export function useEstilos<T>(crearEstilos: (tema: Tema) => T) {
  const tema = useTema();
  const styles = useMemo(() => crearEstilos(tema), [crearEstilos, tema]);
  return { ...tema, styles };
}
