/**
 * Convierte el centro del mapa en un `Place` cada vez que el usuario termina de
 * mover la cámara. Entrega primero las coordenadas con una etiqueta provisional
 * ("Obteniendo dirección…") y luego la dirección real por geocodificación
 * inversa. Una guardia con `useRef` descarta resultados obsoletos si el usuario
 * vuelve a mover el mapa antes de que resuelva un geocode anterior.
 */
import { useCallback, useRef, useState } from 'react';
import type { Region } from 'react-native-maps';

import type { Coordinates, Place } from '@/features/booking/domain/types';
import { locationService } from '@/features/home/data/locationService';

const PENDING_ADDRESS = 'Obteniendo dirección…';

export function useRegionPlace(onPlace: (place: Place) => void, pendingName: string) {
  const latest = useRef<Coordinates | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      const coordinates = { latitude: region.latitude, longitude: region.longitude };
      latest.current = coordinates;
      setIsResolving(true);
      onPlace({
        coordinates,
        name: pendingName,
        address: PENDING_ADDRESS,
        countryCode: null,
      });

      void locationService.reverseGeocode(coordinates).then((label) => {
        const current = latest.current;
        if (
          current &&
          current.latitude === coordinates.latitude &&
          current.longitude === coordinates.longitude
        ) {
          onPlace({ coordinates, ...label });
          setIsResolving(false);
        }
      });
    },
    [onPlace, pendingName],
  );

  return { onRegionChangeComplete, isResolving };
}
