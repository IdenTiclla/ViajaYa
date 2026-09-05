/**
 * Hook de ubicación actual: orquesta el permiso y la posición del dispositivo,
 * exponiendo estados de carga / permiso denegado / error para la UI del mapa.
 *
 * Se apoya en react-query (ya usado en la app) para manejar carga/error sin
 * efectos manuales con setState.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import type { Coordinates } from '@/core/domain/geo';
import { locationService } from '@/features/home/data/locationService';

export type LocationStatus = 'loading' | 'granted' | 'denied' | 'error';

export type CurrentLocation = {
  status: LocationStatus;
  coordinates: Coordinates | null;
  canAskAgain: boolean;
  /** Indica que se muestra temporalmente una última posición conocida. */
  isEstimated: boolean;
  /** Reintenta la solicitud (útil tras denegar o ante un error transitorio). */
  retry: () => void;
};

const CURRENT_LOCATION_KEY = ['current-location'] as const;

export function useCurrentLocation(): CurrentLocation {
  const queryClient = useQueryClient();
  const latestRequestId = useRef(0);

  useEffect(
    () => () => {
      latestRequestId.current += 1;
    },
    [],
  );

  const query = useQuery({
    queryKey: CURRENT_LOCATION_KEY,
    queryFn: () => {
      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      return locationService.getCurrentLocation((updatedLocation) => {
        if (latestRequestId.current !== requestId) return;
        queryClient.setQueryData(CURRENT_LOCATION_KEY, updatedLocation);
      });
    },
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
  const isEstimated = query.data?.status === 'granted' ? query.data.isEstimated : false;
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  return { status, coordinates, canAskAgain, isEstimated, retry };
}
