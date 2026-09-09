/**
 * Destinos recientes del pasajero desde la API (`/rides/recent-destinations`).
 *
 * Conserva los destinos cargados y distingue un fallo de red de una lista vacía.
 */
import { useQuery } from '@tanstack/react-query';

import type { Place } from '@/features/booking/domain/types';
import { ridesRepository } from '@/features/booking/data/ridesRepository';

export function useRecentDestinations(): {
  places: Place[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: ['recent-destinations'],
    queryFn: () => ridesRepository.recentDestinations(),
    staleTime: 60_000,
  });

  return {
    places: query.data ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => { void query.refetch(); },
  };
}
