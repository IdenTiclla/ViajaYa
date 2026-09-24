/**
 * Query hooks of the ride flow (React Query).
 *
 * Real time is pushed by the **WebSocket** (see `useNegotiationSocket` /
 * `useDriverPoolSocket`), which mutates this same cache. `refetchInterval` remains
 * only as a **slow fallback** in case the socket drops (resilience), not as the
 * main path. Queries for a specific ride stop refreshing once
 * the ride reaches a terminal status (`completed`/`cancelled`).
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { flattenOpenRides } from '@/features/rides/application/openRidesCache';
import {
  copyPassengerActiveRideToDetail,
} from '@/features/rides/application/rideStatusReducer';
import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { Ride } from '@/features/rides/domain/types';

// Slow fallback: the WebSocket is the main update path.
const POLL_OFFERS_MS = 15000;
const POLL_RIDE_MS = 15000;
const POLL_OPEN_MS = 20000;
const POLL_ACTIVE_MS = 20000;

export const PASSENGER_ACTIVE_RIDE_KEY = ['passenger-active-ride'] as const;
export const DRIVER_ACTIVE_RIDE_KEY = ['driver-active-ride'] as const;
export const PENDING_RATING_RIDE_KEY = ['pending-rating-ride'] as const;

function isTerminal(status: Ride['status'] | undefined): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** Driver: open requests for their vehicle type. */
export function useOpenRides(enabled = true) {
  const query = useInfiniteQuery({
    queryKey: ['open-rides'],
    queryFn: ({ pageParam, signal }) =>
      ridesRepository.getOpenRides(pageParam, undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: enabled ? POLL_OPEN_MS : false,
    enabled,
  });
  return {
    rides: flattenOpenRides(query.data),
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
  };
}

/** Passenger: pending offers received for their ride. */
export function useRideOffers(
  rideId: string | null,
  enabled = true,
) {
  const active = enabled && !!rideId;
  const query = useQuery({
    queryKey: ['ride-offers', rideId],
    queryFn: ({ signal }) =>
      ridesRepository.listOffers(rideId as string, signal),
    refetchInterval: active ? POLL_OFFERS_MS : false,
    enabled: active,
  });
  return {
    offers: query.data ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Detalle de un viaje con polling (pasajero o conductor). */
export function useRide(rideId: string | null) {
  const query = useQuery({
    queryKey: ['ride', rideId],
    queryFn: ({ signal }) =>
      ridesRepository.getRide(rideId as string, signal),
    enabled: !!rideId,
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? false : POLL_RIDE_MS),
  });
  return {
    ride: query.data,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Passenger: current request or ride, even if it is paused for editing. */
export function usePassengerActiveRide() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: PASSENGER_ACTIVE_RIDE_KEY,
    queryFn: ({ signal }) =>
      ridesRepository.getPassengerActiveRide(signal),
    refetchInterval: (q) =>
      isTerminal(q.state.data?.status) ? false : POLL_ACTIVE_MS,
  });

  // The active endpoint returns the same contract as the detail. Sharing it
  // avoids a second load when recovering Offers, Configure or Trip.
  useEffect(() => {
    if (query.data) {
      copyPassengerActiveRideToDetail(
        queryClient,
        query.data,
        query.dataUpdatedAt,
      );
    }
  }, [query.data, query.dataUpdatedAt, queryClient]);

  return {
    ride: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Driver: assigned active ride (to know whether they were already chosen). */
export function useDriverActiveRide(
  enabled = true,
) {
  const query = useQuery({
    queryKey: DRIVER_ACTIVE_RIDE_KEY,
    // Resolve the closing stage before exposing the requests pool. A lost
    // completion reply can make the active endpoint return null immediately.
    queryFn: async ({ signal }) =>
      (await ridesRepository.getActiveRide(signal))
      ?? (await ridesRepository.getPendingRatingRide(signal)),
    enabled,
    refetchInterval: (q) =>
      enabled && !isTerminal(q.state.data?.status) ? POLL_ACTIVE_MS : false,
  });
  return {
    ride: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Ambos roles: cierre completado que sigue pendiente de calificacion. */
export function usePendingRatingRide(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: PENDING_RATING_RIDE_KEY,
    queryFn: ({ signal }) => ridesRepository.getPendingRatingRide(signal),
    enabled,
  });

  useEffect(() => {
    if (query.data) {
      queryClient.setQueryData(['ride', query.data.id], query.data);
    }
  }, [query.data, queryClient]);

  return {
    ride: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
