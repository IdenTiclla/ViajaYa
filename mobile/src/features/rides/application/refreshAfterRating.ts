import type { QueryClient } from '@tanstack/react-query';

import type { Ride } from '../domain/types';

/** The confirmed close does not wait for another network response to release the screen. */
export async function refreshAfterRating(queryClient: QueryClient, rideId: string): Promise<void> {
  const pending = ['pending-rating-ride'] as const;
  const active = ['driver-active-ride'] as const;
  // Cancellation settles asynchronously. Clear the acknowledged ride only after
  // its old reads settle, so their CancelledError cannot overwrite success.
  await Promise.all([pending, active].map((queryKey) =>
    queryClient.cancelQueries({ queryKey }, { revert: false }),
  ));
  for (const queryKey of [pending, active]) {
    queryClient.setQueryData<Ride | null>(queryKey, (current) =>
      current?.id === rideId ? null : current,
    );
  }
  void queryClient.invalidateQueries({ queryKey: pending, refetchType: 'all' });
  void queryClient.invalidateQueries({ queryKey: ['ride', rideId] });
  void queryClient.invalidateQueries({ queryKey: ['ride-history'] });
  void queryClient.invalidateQueries({ queryKey: ['driver-earnings'] });
}
