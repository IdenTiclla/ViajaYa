/**
 * Current location hook: orchestrates the permission and the device position,
 * exposing loading / permission denied / error states for the map UI.
 *
 * Relies on react-query (already used in the app) to handle loading/error without
 * manual setState effects.
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
  /** Signals that a last known position is being shown temporarily. */
  isEstimated: boolean;
  /** Retry the request (useful after a denial or a transient error). */
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
    // Avoids reusing for hours a position that no longer represents the current
    // starting point, but also does not query the GPS on every render.
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
