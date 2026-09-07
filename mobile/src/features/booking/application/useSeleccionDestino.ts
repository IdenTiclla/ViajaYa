import { useCallback, useEffect, useRef, useState } from 'react';

import { conTiempoLimite } from '@/core/async/conTiempoLimite';
import { getBoliviaPlaceError } from '@/features/booking/domain/bolivia';
import type { Place, PlaceSuggestion } from '@/features/booking/domain/types';

/** Solo la selección vigente puede fijar un destino o mostrar un error. */
export function useSeleccionDestino(
  resolver: (sugerencia: PlaceSuggestion) => Promise<Place | null>,
  alSeleccionar: (lugar: Place) => void,
) {
  const generacion = useRef(0);
  const enCurso = useRef(false);
  const [resolviendoId, setResolviendoId] = useState<string | null>(null);
  const [errorSeleccion, setErrorSeleccion] = useState<string | null>(null);

  useEffect(() => () => { generacion.current += 1; }, []);

  const cancelarSeleccion = useCallback(() => {
    generacion.current += 1;
    enCurso.current = false;
    setResolviendoId(null);
    setErrorSeleccion(null);
  }, []);

  const seleccionarLugar = useCallback((lugar: Place) => {
    cancelarSeleccion();
    const error = getBoliviaPlaceError(lugar);
    if (error) setErrorSeleccion(error);
    else alSeleccionar(lugar);
  }, [alSeleccionar, cancelarSeleccion]);

  const seleccionarSugerencia = useCallback(async (sugerencia: PlaceSuggestion) => {
    if (enCurso.current) return;
    enCurso.current = true;
    const solicitud = ++generacion.current;
    setResolviendoId(sugerencia.placeId);
    setErrorSeleccion(null);
    try {
      const lugar = await conTiempoLimite(
        resolver(sugerencia), 30_000,
        'La ubicación tardó demasiado. Vuelve a intentarlo o elige el punto en el mapa.',
      );
      if (solicitud !== generacion.current) return;
      if (!lugar) throw new Error('No pudimos ubicar este lugar. Prueba otra opción o usa el mapa.');
      const error = getBoliviaPlaceError(lugar);
      if (error) throw new Error(error);
      alSeleccionar(lugar);
    } catch (error) {
      if (solicitud === generacion.current) {
        setErrorSeleccion(error instanceof Error ? error.message : 'No pudimos obtener la ubicación. Vuelve a intentarlo.');
      }
    } finally {
      if (solicitud === generacion.current) {
        enCurso.current = false;
        setResolviendoId(null);
      }
    }
  }, [alSeleccionar, resolver]);

  return { resolviendoId, errorSeleccion, seleccionarSugerencia, seleccionarLugar, cancelarSeleccion };
}
