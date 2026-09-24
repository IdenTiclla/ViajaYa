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
 * A known status cannot go backwards because of a late event or HTTP
 * response. `cancelled` is a valid side exit from a non-terminal status.
 */
export function shouldApplyRideStatus(
  current: Ride | null | undefined,
  incoming: Ride,
): boolean {
  if (current?.id !== incoming.id) return true;
  const currentStatus = current.status;
  const incomingStatus = incoming.status;
  if (currentStatus === incomingStatus) {
    // The pickup notice is permanent. An older same-stage reply cannot undo it.
    return !current.riderOnTheWayAt || Boolean(incoming.riderOnTheWayAt);
  }
  if (currentStatus === 'completed' || currentStatus === 'cancelled') return false;
  if (incomingStatus === 'cancelled') return currentStatus !== 'in_progress';

  return RIDE_STATUS_ORDER[incomingStatus] > RIDE_STATUS_ORDER[currentStatus];
}

export type RideMutationReduction = {
  ride: Ride;
  applied: boolean;
};

/**
 * Resolve an HTTP mutation response against the state the WebSocket
 * may have advanced while the request was still pending.
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
 * Write the HTTP result only if the canonical detail does not already hold a
 * newer terminal status received over WebSocket.
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
  if (currentActive && currentActive.id !== incoming.id && !isTerminalRide(currentActive)) {
    return false;
  }
  if (!shouldApplyRideStatus(currentActive, incoming)) return false;
  const reduction = reduceRideMutationResult(current, incoming);
  if (!reduction.applied) return false;
  queryClient.setQueryData(queryKey, reduction.ride);
  return true;
}

/**
 * Share the active-ride GET with the detail cache without turning a
 * late-running effect into a new write. The timestamp belongs to the
 * source query: a snapshot/delta that already updated the detail with an equal
 * or later local position always keeps the authority.
 */
export function copyPassengerActiveRideToDetail(
  queryClient: QueryClient,
  incoming: Ride,
  sourceUpdatedAt: number,
): boolean {
  const queryKey = ['ride', incoming.id] as const;
  const currentState = queryClient.getQueryState<Ride>(queryKey);
  if (
    currentState?.data !== undefined &&
    currentState.dataUpdatedAt >= sourceUpdatedAt
  ) {
    return false;
  }
  if (!shouldApplyRideStatus(currentState?.data, incoming)) return false;

  queryClient.setQueryData(queryKey, incoming, {
    updatedAt: sourceUpdatedAt,
  });
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
