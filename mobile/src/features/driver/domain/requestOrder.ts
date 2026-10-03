/**
 * Order of the driver's open requests (list and map share it). Pure: the
 * distances come from the caller so this stays free of geo/IO dependencies.
 */
import type { OpenRide } from '@/features/rides/domain/types';

export type RequestOrder = 'nearest' | 'best' | 'recent';

export type RequestDistances = {
  /** Straight-line km from the driver to the pickup, or null without GPS. */
  pickupKm: (ride: OpenRide) => number | null;
  /** Straight-line km of the trip itself. */
  tripKm: (ride: OpenRide) => number;
};

/** Short trips would dominate Bs/km; below this they count as this long. */
const MIN_TRIP_KM_FOR_RATE = 1;

/**
 * Sort without mutating the source array. Ties (and requests the order cannot
 * rank, e.g. "nearest" without GPS) keep their incoming order, so live updates
 * do not reshuffle cards the driver is reading.
 */
export function orderRequests(
  rides: readonly OpenRide[],
  order: RequestOrder,
  distances: RequestDistances,
): OpenRide[] {
  const value = (ride: OpenRide): number => {
    if (order === 'nearest') return distances.pickupKm(ride) ?? Number.POSITIVE_INFINITY;
    if (order === 'best') return -(ride.fare / Math.max(MIN_TRIP_KM_FOR_RATE, distances.tripKm(ride)));
    const created = ride.createdAt ? Date.parse(ride.createdAt) : Number.NaN;
    return Number.isFinite(created) ? -created : Number.POSITIVE_INFINITY;
  };
  return rides
    .map((ride, index) => ({ ride, index, key: value(ride) }))
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1))
    .map(({ ride }) => ride);
}
