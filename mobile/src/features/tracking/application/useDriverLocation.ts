import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { openSocket } from '@/core/realtime/socket';
import type { Ride } from '@/features/rides/domain/types';
import { canTrackRide, locationFreshness, newerLocation, type DriverLocation } from '../domain/driverLocation';
import { driverLocationMessageSchema, driverLocationRepository, toDriverLocation } from '../data/driverLocationRepository';

export function useDriverLocation(ride: Ride | null | undefined) {
  const client = useQueryClient();
  const [now, setNow] = useState(Date.now);
  const active = canTrackRide(ride) && !!ride?.driver;
  const rideId = ride?.id;
  const driverId = ride?.driver?.id;
  const key = ['driver-location', rideId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const before = client.getQueryData<DriverLocation | null>(['driver-location', rideId]);
      const incoming = await driverLocationRepository.get(rideId!, signal);
      if (!incoming && before !== client.getQueryData<DriverLocation | null>(['driver-location', rideId])) {
        return client.getQueryData<DriverLocation | null>(['driver-location', rideId]) ?? null;
      }
      return newerLocation(client.getQueryData<DriverLocation | null>(['driver-location', rideId]), incoming);
    },
    enabled: active,
    refetchInterval: active ? 30_000 : false,
    retry: false,
  });
  useEffect(() => {
    if (!active || !rideId || !driverId) return;
    const socket = openSocket(`/ws/rides/${rideId}/driver-location`, message => {
      const incoming = message.data ? toDriverLocation(message.data) : null;
      if (incoming && (incoming.rideId !== rideId || incoming.driverId !== driverId)) return;
      client.setQueryData<DriverLocation | null>(['driver-location', rideId], current => newerLocation(current, incoming));
    }, driverLocationMessageSchema);
    const timer = setInterval(() => setNow(Date.now()), 2_000);
    return () => { socket.close(); clearInterval(timer); };
  }, [active, rideId, driverId, client]);
  const location = active && query.data && query.data.rideId === rideId && query.data.driverId === driverId ? query.data : null;
  const freshness = locationFreshness(location, now);
  return { location: freshness === 'unavailable' ? null : location, freshness, retry: () => { void query.refetch(); } };
}
