/**
 * Convierte el centro del mapa en un `Place` cada vez que el usuario termina de
 * mover la cámara. Entrega primero las coordenadas con una etiqueta utilizable
 * y luego la enriquece mediante geocodificación inversa. Una guardia con `useRef`
 * deduplica centros idénticos y descarta resultados obsoletos si el usuario vuelve
 * a mover el mapa antes de que resuelva una geocodificación anterior.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Region } from 'react-native-maps';

import type { Coordinates, Place } from '@/features/booking/domain/types';
import { locationService } from '@/features/home/data/locationService';

function mismasCoordenadas(a: Coordinates, b: Coordinates): boolean {
  // MapView puede devolver el mismo centro con una variación decimal mínima
  // después de animateToRegion. Tratarla como un punto nuevo reinicia (o incluso
  // cancela) la primera dirección aunque el pasajero no haya movido el mapa.
  return (
    Math.abs(a.latitude - b.latitude) < 0.00001 &&
    Math.abs(a.longitude - b.longitude) < 0.00001
  );
}

function direccionCoordenadas({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function useRegionPlace(onPlace: (place: Place) => void) {
  const latest = useRef<Coordinates | null>(null);
  const latestRequestId = useRef(0);
  const pending = useRef<Coordinates | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionFailed, setResolutionFailed] = useState(false);

  const cancelPendingResolution = useCallback(() => {
    latestRequestId.current += 1;
    latest.current = null;
    pending.current = null;
    setIsResolving(false);
    setResolutionFailed(false);
  }, []);

  useEffect(
    () => () => {
      // Invalida respuestas tardías para que un logout o cambio de pantalla no
      // vuelva a escribir el store global después de desmontar este hook.
      latestRequestId.current += 1;
      latest.current = null;
      pending.current = null;
    },
    [],
  );

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      const coordinates = { latitude: region.latitude, longitude: region.longitude };
      if (pending.current && mismasCoordenadas(pending.current, coordinates)) return;

      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      latest.current = coordinates;
      pending.current = coordinates;
      setIsResolving(true);
      setResolutionFailed(false);
      onPlace({
        coordinates,
        name: '',
        address: direccionCoordenadas(coordinates),
        countryCode: null,
        labelStatus: 'provisional',
      });

      void locationService
        .reverseGeocode(coordinates)
        .then((label) => {
          const current = latest.current;
          if (
            label &&
            latestRequestId.current === requestId &&
            current &&
            mismasCoordenadas(current, coordinates)
          ) {
            onPlace({ coordinates, ...label });
          } else if (latestRequestId.current === requestId && !label) {
            setResolutionFailed(true);
          }
        })
        .finally(() => {
          if (latestRequestId.current === requestId) {
            pending.current = null;
            setIsResolving(false);
          }
        });
    },
    [onPlace],
  );

  return {
    onRegionChangeComplete,
    isResolving,
    resolutionFailed,
    cancelPendingResolution,
  };
}
