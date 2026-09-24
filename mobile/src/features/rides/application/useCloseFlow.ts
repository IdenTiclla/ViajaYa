/**
 * Ride-closing hooks: history, driver earnings and rating.
 * History and earnings are queried with React Query; rating is
 * a mutation that invalidates the ride and the history to reflect the change.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { recoverCommittedMutation } from './recoverCommittedMutation';
import { refreshAfterRating } from '@/features/rides/application/actualizarTrasCalificacion';
import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { RatingInput, RideStatus } from '@/features/rides/domain/types';

/** The user's ride history (passenger or driver), filterable by status. */
export function useRideHistory(status?: RideStatus) {
  const query = useInfiniteQuery({
    queryKey: ['ride-history', status ?? 'all'],
    queryFn: ({ pageParam, signal }) =>
      ridesRepository.getHistory(status, pageParam, undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  return {
    ...query,
    data: query.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

/** The driver's earnings summary (today, all-time and recent rides). */
export function useDriverEarnings(enabled = true) {
  return useQuery({
    queryKey: ['driver-earnings'],
    queryFn: ({ signal }) => ridesRepository.getEarnings(signal),
    enabled,
  });
}

/** Rate the other participant after the ride is completed. */
export function useRateRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; input: RatingInput }) =>
      recoverCommittedMutation(
        async () => { await ridesRepository.rateRide(vars.rideId, vars.input); return true; },
        () => ridesRepository.hasRating(vars.rideId),
        (saved) => saved,
      ),
    onSuccess: (_data, vars) => refreshAfterRating(queryClient, vars.rideId),
  });
}

/** Explicitly skip the rating and close the pending item on the server. */
export function useSkipRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.skipRating(rideId),
    onSuccess: (_data, rideId) => refreshAfterRating(queryClient, rideId),
  });
}
