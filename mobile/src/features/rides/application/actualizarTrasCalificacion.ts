import type { QueryClient } from '@tanstack/react-query';

import type { Ride } from '../domain/types';

/** El cierre confirmado no espera otra respuesta de red para liberar la pantalla. */
export async function actualizarTrasCalificacion(queryClient: QueryClient, rideId: string): Promise<void> {
  const pendientes = ['pending-rating-ride'] as const;
  const active = ['driver-active-ride'] as const;
  // Cancellation settles asynchronously. Clear the acknowledged ride only after
  // its old reads settle, so their CancelledError cannot overwrite success.
  await Promise.all([pendientes, active].map((queryKey) =>
    queryClient.cancelQueries({ queryKey }, { revert: false }),
  ));
  for (const queryKey of [pendientes, active]) {
    queryClient.setQueryData<Ride | null>(queryKey, (current) =>
      current?.id === rideId ? null : current,
    );
  }
  void queryClient.invalidateQueries({ queryKey: pendientes, refetchType: 'all' });
  void queryClient.invalidateQueries({ queryKey: ['ride', rideId] });
  void queryClient.invalidateQueries({ queryKey: ['ride-history'] });
  void queryClient.invalidateQueries({ queryKey: ['driver-earnings'] });
}
