import type { QueryClient } from '@tanstack/react-query';

import type { Ride } from '../domain/types';

/** El cierre confirmado no espera otra respuesta de red para liberar la pantalla. */
export function actualizarTrasCalificacion(queryClient: QueryClient, rideId: string): void {
  const pendientes = ['pending-rating-ride'] as const;
  // Descarta una lectura anterior al guardado antes de retirar el cierre local.
  void queryClient.cancelQueries({ queryKey: pendientes }, { revert: false });
  queryClient.setQueryData<Ride | null>(pendientes, (current) =>
    current?.id === rideId ? null : current,
  );
  void queryClient.invalidateQueries({ queryKey: pendientes, refetchType: 'all' });
  void queryClient.invalidateQueries({ queryKey: ['ride', rideId] });
  void queryClient.invalidateQueries({ queryKey: ['ride-history'] });
  void queryClient.invalidateQueries({ queryKey: ['driver-earnings'] });
}
