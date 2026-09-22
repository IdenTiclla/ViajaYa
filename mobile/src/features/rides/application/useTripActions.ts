import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { Linking, Share } from 'react-native';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { useCancelRide, useMarkRiderOnTheWay, useUpdateRideStatus } from './useRideMutations';
import { DRIVER_ACTIVE_RIDE_KEY, PASSENGER_ACTIVE_RIDE_KEY } from './useRides';
import type { Ride, RideStatus } from '../domain/types';

const NEXT_STATUS: Partial<Record<RideStatus, RideStatus>> = {
  accepted: 'arriving', arriving: 'in_progress', in_progress: 'completed',
};

/** Guard actions against repeated taps and confirmations from a previous stage. */
export function useTripActions(ride: Ride | undefined) {
  const queryClient = useQueryClient();
  const update = useUpdateRideStatus();
  const cancellation = useCancelRide();
  const pickupNotice = useMarkRiderOnTheWay();
  const locked = useRef(false);
  const busy = update.isPending || cancellation.isPending || pickupNotice.isPending;
  const latest = useRef({ ride, busy });
  useLayoutEffect(() => { latest.current = { ride, busy }; }, [ride, busy]);
  const pickupError = ride?.status === 'arriving' && !ride.riderOnTheWayAt
    ? pickupNotice.error
    : null;
  const error = update.error ?? cancellation.error ?? pickupError;

  const run = async (expectedStatus: RideStatus, action: () => Promise<unknown>) => {
    const current = latest.current;
    if (!ride || current.ride?.id !== ride.id || current.ride.status !== expectedStatus
      || locked.current || current.busy) return;
    locked.current = true;
    update.reset();
    cancellation.reset();
    pickupNotice.reset();
    try {
      await action();
    } catch {
      // A lost HTTP reply may hide a committed transition. Recover both views.
      void queryClient.invalidateQueries({ queryKey: ['ride', ride.id] });
      void queryClient.invalidateQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY });
      void queryClient.invalidateQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY });
    } finally {
      locked.current = false;
    }
  };

  return {
    busy,
    notifyingOnTheWay: pickupNotice.isPending,
    error: error ? getApiErrorMessage(error) : null,
    notifyOnTheWay() {
      if (ride && !latest.current.ride?.riderOnTheWayAt) {
        void run('arriving', () => pickupNotice.mutateAsync(ride.id));
      }
    },
    advance(expectedStatus: RideStatus) {
      const status = NEXT_STATUS[expectedStatus];
      if (ride && status) void run(expectedStatus, () => update.mutateAsync({ rideId: ride.id, status }));
    },
    cancel(expectedStatus: RideStatus) {
      if (ride && ['searching', 'accepted', 'arriving'].includes(expectedStatus)) {
        void run(expectedStatus, () => cancellation.mutateAsync(ride.id));
      }
    },
  };
}

/** Report unavailable native handlers instead of losing rejected promises. */
export function useTripContact(ride: Ride | undefined, phone: string | null | undefined) {
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try { await action(); } catch { setError(message); }
  };
  return {
    error,
    call() {
      if (phone) void run(() => Linking.openURL(`tel:${phone}`), 'No pudimos abrir la llamada. Intenta enviar un mensaje.');
    },
    message() {
      if (phone) void run(() => Linking.openURL(`sms:${phone}`), 'No pudimos abrir los mensajes. Intenta llamar.');
    },
    share() {
      if (!ride) return;
      const driver = ride.driver;
      const details = [driver?.fullName, driver?.vehicleModel, driver?.plate].filter(Boolean).join(' · ');
      void run(() => Share.share({
        message: `${SERVICE_META[ride.service].label} con ViajaYa: ${ride.origin.name} → ${ride.destination.name}.`
          + (details ? ` Conductor: ${details}.` : ''),
      }), 'No pudimos abrir las opciones para compartir. Inténtalo de nuevo.');
    },
  };
}
