import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { Ride, RideStatus } from '@/features/rides/domain/types';

const RIDE_STATUS_ORDER: Record<Exclude<RideStatus, 'cancelled'>, number> = {
  searching: 0,
  accepted: 1,
  arriving: 2,
  in_progress: 3,
  completed: 4,
};

export function isTerminalRide(ride: Ride | null | undefined): boolean {
  return ride?.status === 'completed' || ride?.status === 'cancelled';
}

/**
 * Un estado conocido no puede retroceder por un evento o una respuesta HTTP
 * atrasada. `cancelled` es una salida lateral válida desde un no terminal.
 */
export function shouldApplyRideStatus(
  current: Ride | null | undefined,
  incoming: Ride,
): boolean {
  if (current?.id !== incoming.id) return true;
  const currentStatus = current.status;
  const incomingStatus = incoming.status;
  if (currentStatus === incomingStatus) return true;
  if (currentStatus === 'completed' || currentStatus === 'cancelled') return false;
  if (incomingStatus === 'cancelled') return currentStatus !== 'in_progress';

  return RIDE_STATUS_ORDER[incomingStatus] > RIDE_STATUS_ORDER[currentStatus];
}

export type RideMutationReduction = {
  ride: Ride;
  applied: boolean;
};

/**
 * Resuelve una respuesta HTTP de mutación contra el estado que pudo adelantar
 * el WebSocket mientras la petición seguía pendiente.
 */
export function reduceRideMutationResult(
  current: Ride | null | undefined,
  incoming: Ride,
): RideMutationReduction {
  if (current && !shouldApplyRideStatus(current, incoming)) {
    return { ride: current, applied: false };
  }
  return { ride: incoming, applied: true };
}

/**
 * Escribe el resultado HTTP solo si el detalle canónico no contiene ya un
 * terminal más nuevo recibido por WebSocket.
 */
export function applyRideMutationResult(
  queryClient: QueryClient,
  incoming: Ride,
  activeQueryKey?: QueryKey,
): boolean {
  const queryKey = ['ride', incoming.id] as const;
  const current = queryClient.getQueryData<Ride>(queryKey);
  const currentActive = activeQueryKey
    ? queryClient.getQueryData<Ride | null>(activeQueryKey)
    : null;
  if (!shouldApplyRideStatus(currentActive, incoming)) return false;
  const reduction = reduceRideMutationResult(current, incoming);
  if (!reduction.applied) return false;
  queryClient.setQueryData(queryKey, reduction.ride);
  return true;
}

export function reducePassengerActiveRide(
  current: Ride | null | undefined,
  incoming: Ride,
): Ride | null {
  if (!shouldApplyRideStatus(current, incoming)) return current ?? null;
  if (isTerminalRide(incoming)) {
    return current?.id === incoming.id ? null : (current ?? null);
  }
  return current == null || current.id === incoming.id ? incoming : current;
}

export function reduceDriverActiveRide(
  current: Ride | null | undefined,
  incoming: Ride,
): Ride | null | undefined {
  return current?.id === incoming.id && shouldApplyRideStatus(current, incoming)
    ? incoming
    : current;
}
