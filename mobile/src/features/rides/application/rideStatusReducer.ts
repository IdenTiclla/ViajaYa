import type { QueryClient } from '@tanstack/react-query';

import type { Ride } from '@/features/rides/domain/types';

export function isTerminalRide(ride: Ride | null | undefined): boolean {
  return ride?.status === 'completed' || ride?.status === 'cancelled';
}

/** Un estado terminal conocido no puede retroceder por un evento atrasado. */
export function shouldApplyRideStatus(
  current: Ride | null | undefined,
  incoming: Ride,
): boolean {
  return !(
    current?.id === incoming.id &&
    isTerminalRide(current) &&
    current.status !== incoming.status
  );
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
): boolean {
  const queryKey = ['ride', incoming.id] as const;
  const current = queryClient.getQueryData<Ride>(queryKey);
  const reduction = reduceRideMutationResult(current, incoming);
  if (!reduction.applied) return false;
  queryClient.setQueryData(queryKey, reduction.ride);
  return true;
}

export function reducePassengerActiveRide(
  current: Ride | null | undefined,
  incoming: Ride,
): Ride | null {
  if (isTerminalRide(incoming)) {
    return current?.id === incoming.id ? null : (current ?? null);
  }
  return current == null || current.id === incoming.id ? incoming : current;
}

export function reduceDriverActiveRide(
  current: Ride | null | undefined,
  incoming: Ride,
): Ride | null | undefined {
  return current?.id === incoming.id ? incoming : current;
}
