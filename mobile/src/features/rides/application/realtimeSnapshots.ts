/** Aplicación autoritativa de snapshots v2 sobre React Query y Zustand. */

import type { QueryClient, QueryKey } from '@tanstack/react-query';

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
  offered: Record<string, { rideFare: number }>;
  reconcilePoolSnapshot: (
    rides: {
      rideId: string;
      poolVersion: number;
      phase: 'open' | 'paused';
    }[],
  ) => void;
  reconcileOffered: (
    offers: {
      rideId: string;
      id: string;
      price: number;
      rideFare: number;
      etaMin: number | null;
      expiresAt: string | null;
    }[],
    cut?: OfferSnapshotCut,
  ) => void;
  beginOfferSnapshot: () => OfferSnapshotCut;
  markAssigned: (rideId: string) => boolean;
};

export async function applyPassengerRealtimeSnapshot(
  queryClient: QueryClient,
  activeRideKey: QueryKey,
  snapshot: PassengerSnapshotProjection,
): Promise<void> {
  const rideKey = ['ride', snapshot.ride.id] as const;
  const offersKey = ['ride-offers', snapshot.ride.id] as const;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: rideKey, exact: true }),
    queryClient.cancelQueries({ queryKey: offersKey, exact: true }),
    queryClient.cancelQueries({ queryKey: activeRideKey, exact: true }),
  ]);
  queryClient.setQueryData(rideKey, snapshot.ride);
  queryClient.setQueryData(offersKey, snapshot.offers);
  queryClient.setQueryData(
    activeRideKey,
    snapshot.ride.status === 'completed' || snapshot.ride.status === 'cancelled'
      ? null
      : snapshot.ride,
  );
}

export async function applyDriverRealtimeSnapshot(
  queryClient: QueryClient,
  activeRideKey: QueryKey,
  driverRequests: DriverSnapshotStore,
  snapshot: DriverSnapshotProjection,
): Promise<void> {
  const offerCut = driverRequests.beginOfferSnapshot();
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
  queryClient.setQueryData(['open-rides'], openAndPaused);
  queryClient.setQueryData(activeRideKey, snapshot.activeRide);
  if (snapshot.activeRide != null) {
    queryClient.setQueryData(
      ['ride', snapshot.activeRide.id],
      snapshot.activeRide,
    );
  }

  driverRequests.reconcilePoolSnapshot([
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
  ]);
  const fares = new Map(
    [...snapshot.openRides.items, ...snapshot.pausedRides].map((ride) => [
      ride.id,
      ride.fare,
    ]),
  );
  driverRequests.reconcileOffered(
    snapshot.offers.map((offer) => ({
      rideId: offer.rideId,
      id: offer.id,
      price: offer.price,
      rideFare:
        fares.get(offer.rideId) ??
        driverRequests.offered[offer.rideId]?.rideFare ??
        offer.price,
      etaMin: offer.etaMin,
      expiresAt: offer.expiresAt,
    })),
    offerCut,
  );
  if (snapshot.activeRide != null) {
    driverRequests.markAssigned(snapshot.activeRide.id);
  }
}
