import type { Ride } from '@/features/rides/domain/types';

export type DriverLocation = {
  rideId: string;
  driverId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  heading: number | null;
  capturedAt: string;
  receivedAt: string;
};

export function canTrackRide(ride: Pick<Ride, 'status'> | null | undefined): boolean {
  return !!ride && ['accepted', 'arriving', 'in_progress'].includes(ride.status);
}

export function newerLocation(current: DriverLocation | null | undefined, incoming: DriverLocation | null) {
  if (!incoming) return null;
  if (!current || current.rideId !== incoming.rideId || current.driverId !== incoming.driverId) return incoming;
  return Date.parse(incoming.capturedAt) > Date.parse(current.capturedAt) ? incoming : current;
}

export function locationFreshness(location: DriverLocation | null, now = Date.now()) {
  if (!location) return 'waiting' as const;
  const age = now - Date.parse(location.capturedAt);
  if (age > 120_000 || age < -10_000) return 'unavailable' as const;
  return age > 20_000 ? 'stale' as const : 'live' as const;
}
