/** Aplicación autoritativa de snapshots v2 sobre React Query y Zustand. */

import {
  notifyManager,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import type { CursorPage } from '../data/ridesRepository';
import type { Offer, OpenRide, Ride } from '../domain/types';
import { reduceRideMutationResult } from './rideStatusReducer';

type OfferSnapshotCut = {
  attemptSequence: number;
};

type PassengerSnapshotProjection = {
  ride: Ride;
  offers: Offer[];
};

type DriverSnapshotProjection = {
  openRides: CursorPage<OpenRide>;
  pausedRides: OpenRide[];
  offers: Offer[];
  activeRide: Ride | null;
};

type DriverSnapshotStore = {
  reconcileRealtimeSnapshot: (snapshot: {
    rides: {
      rideId: string;
      poolVersion: number;
      phase: 'open' | 'paused';
    }[];
    offers: {
      rideId: string;
      id: string;
      price: number;
      rideFare?: number;
      etaMin: number | null;
      expiresAt: string | null;
    }[];
    activeRideId: string | null;
    offerCut: OfferSnapshotCut;
  }) => void;
  beginOfferSnapshot: () => OfferSnapshotCut;
};

type RealtimeSnapshotGuard = () => boolean;

const ALWAYS_CURRENT: RealtimeSnapshotGuard = () => true;

/** HTTP may confirm a later stage while a reconnect snapshot is in flight. */
function reconcileSnapshotRide(queryClient: QueryClient, activeKey: QueryKey, incoming: Ride): Ride {
  const detail = queryClient.getQueryData<Ride>(['ride', incoming.id]);
  const active = queryClient.getQueryData<Ride | null>(activeKey);
  const reconciled = reduceRideMutationResult(detail, incoming).ride;
  return reduceRideMutationResult(active, reconciled).ride;
}

export async function applyPassengerRealtimeSnapshot(
  queryClient: QueryClient,
  activeRideKey: QueryKey,
  snapshot: PassengerSnapshotProjection,
  isCurrent: RealtimeSnapshotGuard = ALWAYS_CURRENT,
): Promise<void> {
  const rideKey = ['ride', snapshot.ride.id] as const;
  const offersKey = ['ride-offers', snapshot.ride.id] as const;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: rideKey, exact: true }),
    queryClient.cancelQueries({ queryKey: offersKey, exact: true }),
    queryClient.cancelQueries({ queryKey: activeRideKey, exact: true }),
  ]);
  if (!isCurrent()) return;

  notifyManager.batch(() => {
    const ride = reconcileSnapshotRide(queryClient, activeRideKey, snapshot.ride);
    queryClient.setQueryData(rideKey, ride);
    queryClient.setQueryData(offersKey, snapshot.offers);
    queryClient.setQueryData(
      activeRideKey,
      ride.status === 'completed' ||
        ride.status === 'cancelled'
        ? null
        : ride,
    );
  });
}

export async function applyDriverRealtimeSnapshot(
  queryClient: QueryClient,
  activeRideKey: QueryKey,
  driverRequests: DriverSnapshotStore,
  snapshot: DriverSnapshotProjection,
  isCurrent: RealtimeSnapshotGuard = ALWAYS_CURRENT,
): Promise<void> {
  const offerCut = driverRequests.beginOfferSnapshot();
  if (!isCurrent()) return;

  const pausedIds = new Set(snapshot.pausedRides.map((ride) => ride.id));
  const openAndPaused = {
    pages: [
      {
        ...snapshot.openRides,
        items: [
          ...snapshot.pausedRides,
          ...snapshot.openRides.items.filter(
            (ride) => !pausedIds.has(ride.id),
          ),
        ],
      },
    ],
    pageParams: [null],
  };
  const poolRides = [
    ...snapshot.openRides.items.map((ride) => ({
      rideId: ride.id,
      poolVersion: ride.poolVersion,
      phase: 'open' as const,
    })),
    ...snapshot.pausedRides.map((ride) => ({
      rideId: ride.id,
      poolVersion: ride.poolVersion,
      phase: 'paused' as const,
    })),
  ];
  const fares = new Map(
    [...snapshot.openRides.items, ...snapshot.pausedRides].map((ride) => [
      ride.id,
      ride.fare,
    ]),
  );
  const offers = snapshot.offers.map((offer) => ({
    rideId: offer.rideId,
    id: offer.id,
    price: offer.price,
    rideFare: fares.get(offer.rideId),
    etaMin: offer.etaMin,
    expiresAt: offer.expiresAt,
  }));
  const cancellations = [
    queryClient.cancelQueries({ queryKey: ['open-rides'], exact: true }),
    queryClient.cancelQueries({ queryKey: activeRideKey, exact: true }),
  ];
  if (snapshot.activeRide != null) {
    cancellations.push(
      queryClient.cancelQueries({
        queryKey: ['ride', snapshot.activeRide.id],
        exact: true,
      }),
    );
  }
  await Promise.all(cancellations);
  if (!isCurrent()) return;

  // Query observers se notifican al salir del batch; la única transición de
  // Zustand ocurre cuando todas las cachés ya contienen la misma fotografía.
  notifyManager.batch(() => {
    const activeRide = snapshot.activeRide == null ? null
      : reconcileSnapshotRide(queryClient, activeRideKey, snapshot.activeRide);
    queryClient.setQueryData(['open-rides'], openAndPaused);
    queryClient.setQueryData(activeRideKey, activeRide);
    if (activeRide != null) {
      queryClient.setQueryData(
        ['ride', activeRide.id],
        activeRide,
      );
    }
    driverRequests.reconcileRealtimeSnapshot({
      rides: poolRides,
      offers,
      activeRideId: activeRide?.id ?? null,
      offerCut,
    });
  });
}
