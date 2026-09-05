/** Aplicación autoritativa de snapshots v2 sobre React Query y Zustand. */

import {
  notifyManager,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import type { CursorPage } from '../data/ridesRepository';
import type { Offer, OpenRide, Ride } from '../domain/types';

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
    queryClient.setQueryData(rideKey, snapshot.ride);
    queryClient.setQueryData(offersKey, snapshot.offers);
    queryClient.setQueryData(
      activeRideKey,
      snapshot.ride.status === 'completed' ||
        snapshot.ride.status === 'cancelled'
        ? null
        : snapshot.ride,
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
    queryClient.setQueryData(['open-rides'], openAndPaused);
    queryClient.setQueryData(activeRideKey, snapshot.activeRide);
    if (snapshot.activeRide != null) {
      queryClient.setQueryData(
        ['ride', snapshot.activeRide.id],
        snapshot.activeRide,
      );
    }
    driverRequests.reconcileRealtimeSnapshot({
      rides: poolRides,
      offers,
      activeRideId: snapshot.activeRide?.id ?? null,
      offerCut,
    });
  });
}
