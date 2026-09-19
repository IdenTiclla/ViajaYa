import { useEffect } from 'react';

import { useOpenRides } from '@/features/rides/application/useRides';

/** A pending offer may belong to a request beyond the first page of the pool. */
export function useNegotiationRide(rideId: string | undefined, enabled: boolean) {
  const query = useOpenRides(enabled && !!rideId);
  const ride = query.rides.find((item) => item.id === rideId) ?? null;
  const searchingPages = enabled && !!rideId && !ride && query.hasNextPage;
  const { fetchNextPage } = query;

  useEffect(() => {
    if (searchingPages && !query.isFetchingNextPage && !query.isError) {
      void fetchNextPage();
    }
  }, [searchingPages, query.isFetchingNextPage, query.isError, fetchNextPage]);

  return {
    ...query,
    ride,
    isLoading: query.isLoading || (searchingPages && !query.isError),
    refetch: query.isFetchNextPageError ? query.fetchNextPage : query.refetch,
  };
}
