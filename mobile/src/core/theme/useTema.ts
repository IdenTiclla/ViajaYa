import { createContext, useContext, useMemo } from 'react';

import { obtenerTema, TEMA_PREDETERMINADO, type Tema } from './tokens';

export const ContextoTema = createContext<Tema>(obtenerTema(TEMA_PREDETERMINADO));

export function useTema() {
  return useContext(ContextoTema);
}

/** Recompute only the styles; switching theme keeps screens and state. */
export function useEstilos<T>(crearEstilos: (tema: Tema) => T) {
  const tema = useTema();
  const styles = useMemo(() => crearEstilos(tema), [crearEstilos, tema]);
  return { ...tema, styles };
}
