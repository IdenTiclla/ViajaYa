/**
 * The passenger's recent destinations from the API (`/rides/recent-destinations`).
 *
 * Keeps the loaded destinations and tells a network failure apart from an empty list.
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
