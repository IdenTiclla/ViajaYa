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
