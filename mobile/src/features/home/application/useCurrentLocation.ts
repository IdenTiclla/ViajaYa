/**
 * Hook de ubicación actual: orquesta el permiso y la posición del dispositivo,
 * exponiendo estados de carga / permiso denegado / error para la UI del mapa.
 *
 * Se apoya en react-query (ya usado en la app) para manejar carga/error sin
 * efectos manuales con setState.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { type Coordinates, locationService } from '@/features/home/data/locationService';

export type LocationStatus = 'loading' | 'granted' | 'denied' | 'error';

export type CurrentLocation = {
  status: LocationStatus;
  coordinates: Coordinates | null;
  canAskAgain: boolean;
  /** Reintenta la solicitud (útil tras denegar o ante un error transitorio). */
  retry: () => void;
};

export function useCurrentLocation(): CurrentLocation {
  const query = useQuery({
    queryKey: ['current-location'],
    queryFn: () => locationService.getCurrentLocation(),
    // Evita reutilizar durante horas una posición que ya no representa el punto
    // de partida actual, pero tampoco consulta el GPS en cada render.
    staleTime: 60_000,
    refetchOnMount: true,
    retry: false,
  });

  const status: LocationStatus = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : query.data?.status === 'denied'
        ? 'denied'
        : 'granted';

  const coordinates = query.data?.status === 'granted' ? query.data.coordinates : null;
  const canAskAgain = query.data?.status === 'denied' ? query.data.canAskAgain : true;
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  return { status, coordinates, canAskAgain, retry };
}
