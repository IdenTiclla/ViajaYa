/**
 * Ride flow mutations (offer, accept, advance status, cancel,
 * driver availability). After each mutation the affected queries are
 * invalidated so polling reflects the new state immediately.
 */
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';

import { recoverCommittedMutation } from './recoverCommittedMutation';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import {
  emptyOpenRides,
  type OpenRidesInfiniteData,
} from '@/features/rides/application/openRidesCache';
import { applyRideMutationResult } from '@/features/rides/application/rideStatusReducer';
import {
  DRIVER_ACTIVE_RIDE_KEY,
  PASSENGER_ACTIVE_RIDE_KEY,
} from '@/features/rides/application/useRides';
import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type {
  CreateOfferInput,
  EditRideInput,
  Ride,
  RideStatus,
} from '@/features/rides/domain/types';
import { useAuthStore } from '@/store/authStore';

function updateActiveRideIfMatching(
  queryClient: QueryClient,
  queryKey: readonly string[],
  ride: Ride,
): void {
  queryClient.setQueryData<Ride | null>(queryKey, (current) =>
    current?.id === ride.id ? ride : current,
  );
}

/** Driver: offer on a request (accept at the price or counter-offer). */
export function useCreateOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; input: CreateOfferInput }) =>
      ridesRepository.createOffer(vars.rideId, vars.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-active-ride'] });
    },
  });
}

/**
 * Passenger: accept an offer and get the ride assigned (final decision). The backend
 * returns the already assigned ride; it is reflected instantly in the ride's cache.
 */
export function useAcceptOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { offerId: string; rideId: string }) => recoverCommittedMutation(
      () => ridesRepository.acceptOffer(vars.offerId),
      () => ridesRepository.getRide(vars.rideId),
      (ride) => ride.id === vars.rideId && Boolean(ride.driver)
        && !['searching', 'cancelled'].includes(ride.status),
    ),
    onSuccess: async (ride) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['ride', ride.id] }),
        queryClient.cancelQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY }),
      ]);
      if (!applyRideMutationResult(queryClient, ride, PASSENGER_ACTIVE_RIDE_KEY)) return;
      queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY,
        ['completed', 'cancelled'].includes(ride.status) ? null : ride);
    },
  });
}

/** Driver: withdraw their offer (or decline to confirm an accepted one). */
export function useWithdrawOffer() {
  return useMutation({
    mutationFn: (offerId: string) => ridesRepository.withdrawOffer(offerId),
  });
}

/** Driver: stop seeing a request until the passenger renews it. */
export function useDismissOpenRide() {
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.dismissOpenRide(rideId),
  });
}

/** Passenger: reject a specific offer (without assigning a driver). */
export function useRejectOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { offerId: string; rideId: string }) =>
      ridesRepository.rejectOffer(vars.offerId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['ride-offers', vars.rideId] });
    },
  });
}

/** Driver: advance the ride's status (arrived → start → finish). */
export function useUpdateRideStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; status: RideStatus }) =>
      recoverCommittedMutation(
        () => ridesRepository.updateStatus(vars.rideId, vars.status),
        () => ridesRepository.getRide(vars.rideId),
        (ride) => ride.status === vars.status || ride.status === 'completed'
          || ride.status === 'cancelled'
          || (vars.status === 'arriving' && ride.status === 'in_progress'),
      ),
    onMutate: () => queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY }),
    onSuccess: async (ride) => {
      await queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY });
      if (!applyRideMutationResult(queryClient, ride, DRIVER_ACTIVE_RIDE_KEY)) return;
      queryClient.setQueryData(DRIVER_ACTIVE_RIDE_KEY, ride);
    },
  });
}

/** Passenger: persist a pickup acknowledgement and reconcile lost responses. */
export function useMarkRiderOnTheWay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => recoverCommittedMutation(
      () => ridesRepository.markRiderOnTheWay(rideId),
      () => ridesRepository.getRide(rideId),
      (ride) => Boolean(ride.riderOnTheWayAt) || !['accepted', 'arriving', 'searching'].includes(ride.status),
    ),
    onSuccess: async (ride) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['ride', ride.id] }),
        queryClient.cancelQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY }),
      ]);
      if (!applyRideMutationResult(queryClient, ride, PASSENGER_ACTIVE_RIDE_KEY)) return;
      queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY,
        ['completed', 'cancelled'].includes(ride.status) ? null : ride);
    },
  });
}

/** Cancela el viaje (pasajero o conductor asignado). */
export function useCancelRide() {
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.cancel(rideId),
    onMutate: (rideId) =>
      Promise.all([
        queryClient.cancelQueries({ queryKey: ['ride', rideId] }),
        queryClient.cancelQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY }),
        queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY }),
      ]),
    onSuccess: (ride) => {
      const activeQueryKey =
        role === 'passenger' ? PASSENGER_ACTIVE_RIDE_KEY : DRIVER_ACTIVE_RIDE_KEY;
      if (!applyRideMutationResult(queryClient, ride, activeQueryKey)) return;
      if (role === 'passenger') {
        // "Active" is a non-terminal contract. Clearing it before the refetch keeps
        // Home from reusing an earlier SEARCHING while it confirms with the server.
        queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY, null);
        void queryClient.invalidateQueries({
          queryKey: PASSENGER_ACTIVE_RIDE_KEY,
          refetchType: 'active',
        });
      } else {
        // The driver keeps the terminal status until acknowledging it on their screen.
        updateActiveRideIfMatching(queryClient, DRIVER_ACTIVE_RIDE_KEY, ride);
      }
    },
  });
}

/**
 * Passenger: adjust the fare of the searching request. Updates the ride
 * detail cache instantly; drivers see the new amount live
 * over WebSocket (the backend re-announces the request to the pool).
 */
export function useUpdateRideFare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; fare: number }) =>
      ridesRepository.updateFare(vars.rideId, vars.fare),
    onSuccess: (ride) => {
      if (!applyRideMutationResult(queryClient, ride, PASSENGER_ACTIVE_RIDE_KEY)) return;
      queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY, ride);
    },
  });
}

/** Driver: toggle their availability (online/offline). */
export function useSetOnline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (isOnline: boolean) => ridesRepository.setOnline(isOnline),
    onSuccess: (isOnline) => {
      useAuthStore.setState((state) => ({
        user: state.user ? { ...state.user, isOnline } : null,
      }));
      if (isOnline) {
        void queryClient.invalidateQueries({ queryKey: ['open-rides'] });
      } else {
        queryClient.setQueryData<OpenRidesInfiniteData>(
          ['open-rides'],
          emptyOpenRides(),
        );
        // The HTTP commit already withdrew the offers even if the WS notice is lost.
        const driverRequests = useDriverRequests.getState();
        driverRequests.invalidateAllOfferAttempts();
        driverRequests.reconcileOffered([]);
      }
    },
  });
}

/** Passenger: pause the request to edit it (Modify request). */
export function usePauseForEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.pauseForEdit(rideId),
    onSuccess: (ride) => {
      if (!applyRideMutationResult(queryClient, ride, PASSENGER_ACTIVE_RIDE_KEY)) return;
      queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY, ride);
      void queryClient.invalidateQueries({ queryKey: ['ride-offers', ride.id] });
    },
  });
}

/** Passenger: save the changes to a paused request and publish it again. */
export function useEditRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; input: EditRideInput }) =>
      recoverCommittedMutation(
        () => ridesRepository.editRide(vars.rideId, vars.input),
        () => ridesRepository.getRide(vars.rideId),
        (ride) => !ride.paused || ride.status !== 'searching',
      ),
    onSuccess: async (ride) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['ride', ride.id] }),
        queryClient.cancelQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY }),
      ]);
      if (!applyRideMutationResult(queryClient, ride, PASSENGER_ACTIVE_RIDE_KEY)) return;
      queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY, ride);
      void queryClient.invalidateQueries({ queryKey: ['ride-offers', ride.id] });
      void queryClient.invalidateQueries({ queryKey: ['open-rides'] });
    },
  });
}
