/**
 * Route (street route + distance/duration) between origin and destination,
 * cached with react-query and keyed by both points' coordinates.
 */
import { useQuery } from '@tanstack/react-query';

import { routeTravelMode } from '../domain/routeTravelMode';
import type { Place, ServiceType } from '@/features/booking/domain/types';
import { fetchRoute, type RouteResult } from '@/features/booking/data/routesService';

export function useRoute(
  origin: Place | null,
  destination: Place | null,
  service: ServiceType,
): { route: RouteResult | null; isLoading: boolean; retry: () => void } {
  const o = origin?.coordinates;
  const d = destination?.coordinates;

  const query = useQuery({
    queryKey: ['route', routeTravelMode(service), o?.latitude, o?.longitude, d?.latitude, d?.longitude],
    queryFn: ({ signal }) => fetchRoute(o!, d!, service, signal),
    enabled: Boolean(o && d),
    // Keep the previous geometry only for these exact endpoints while changing
    // vehicle profile. Never fit a temporary straight line during that refresh.
    placeholderData: (previous, query) => {
      const key = query?.queryKey;
      return key?.[2] === o?.latitude && key?.[3] === o?.longitude
        && key?.[4] === d?.latitude && key?.[5] === d?.longitude ? previous : undefined;
    },
    staleTime: 60_000,
    retry: false,
  });

  return { route: query.data ?? null, isLoading: query.isFetching, retry: () => { void query.refetch(); } };
}
