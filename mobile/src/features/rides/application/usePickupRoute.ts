/**
 * Street route from the driver's live position to the pickup point while the
 * ride is being picked up. The query is keyed by the driver's grid cell (not the
 * raw GPS fix) so it is recomputed about every 220 m instead of every second,
 * and the map and the screen reading the ETA share the same request.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Coordinates, ServiceType } from '@/features/booking/domain/types';
import { routeTravelMode } from '@/features/booking/domain/routeTravelMode';
import { fetchRoute } from '@/features/booking/data/routesService';
import {
  PICKUP_ARRIVED_METERS,
  approxDistanceMeters,
  pickupRouteCell,
  trimRouteToVehicle,
} from '@/features/rides/domain/pickupRoute';

export type PickupRoute = {
  /** Route drawn from the vehicle to the pickup point (empty when not available). */
  coordinates: Coordinates[];
  distanceMeters: number;
  durationSeconds: number;
};

export function usePickupRoute(
  vehicle: Coordinates | null,
  pickup: Coordinates | null,
  service: ServiceType,
): { route: PickupRoute | null; arrived: boolean } {
  const cell = vehicle ? pickupRouteCell(vehicle) : null;
  const arrived = Boolean(vehicle && pickup && approxDistanceMeters(vehicle, pickup) <= PICKUP_ARRIVED_METERS);

  const query = useQuery({
    queryKey: ['pickup-route', routeTravelMode(service), cell?.[0], cell?.[1], pickup?.latitude, pickup?.longitude],
    // The request starts at the fix of the render that changed the cell (the
    // freshest one), without putting the raw position in the key.
    queryFn: ({ signal }) => fetchRoute(vehicle!, pickup!, service, signal),
    enabled: Boolean(cell && pickup && !arrived),
    // Keep the previous geometry while the next cell is computed: it is trimmed
    // to the vehicle anyway, so the line never disappears between refreshes.
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      return key?.[4] === pickup?.latitude && key?.[5] === pickup?.longitude ? previous : undefined;
    },
    staleTime: 60_000,
    retry: false,
  });

  const data = arrived ? null : query.data;
  const route = useMemo<PickupRoute | null>(() => {
    if (!data || !vehicle || data.coordinates.length < 2) return null;
    return {
      coordinates: trimRouteToVehicle(data.coordinates, vehicle),
      distanceMeters: data.distanceMeters,
      durationSeconds: data.durationSeconds,
    };
  }, [data, vehicle]);

  return { route, arrived };
}
