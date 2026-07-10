/**
 * Hooks del cierre del viaje: historial, ganancias del conductor y calificación.
 * El historial y las ganancias se consultan con React Query; la calificación es
 * una mutación que invalida el viaje y el historial para reflejar el cambio.
 */
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { PENDING_RATING_RIDE_KEY } from '@/features/rides/application/useRides';
import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { RatingInput, Ride, RideStatus } from '@/features/rides/domain/types';

async function refreshAfterRating(queryClient: QueryClient, rideId: string): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: ['ride', rideId] });
  void queryClient.invalidateQueries({ queryKey: ['ride-history'] });
  void queryClient.invalidateQueries({ queryKey: ['driver-earnings'] });

  // Conserva el cierre actual durante el refetch para que la tarjeta no se
  // desmonte a mitad de la mutación. Después solo limpia si el servidor no
  // reemplazó la caché por otro cierre pendiente.
  await queryClient.invalidateQueries({
    queryKey: PENDING_RATING_RIDE_KEY,
    refetchType: 'all',
  });
  queryClient.setQueryData<Ride | null>(PENDING_RATING_RIDE_KEY, (current) =>
    current?.id === rideId ? null : current,
  );
}

/** Historial de viajes del usuario (pasajero o conductor), filtrable por estado. */
export function useRideHistory(status?: RideStatus) {
  return useQuery({
    queryKey: ['ride-history', status ?? 'all'],
    queryFn: () => ridesRepository.getHistory(status),
  });
}

/** Resumen de ganancias del conductor (hoy, histórico y viajes recientes). */
export function useDriverEarnings(enabled = true) {
  return useQuery({
    queryKey: ['driver-earnings'],
    queryFn: () => ridesRepository.getEarnings(),
    enabled,
  });
}

/** Califica al otro participante tras completarse el viaje. */
export function useRateRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; input: RatingInput }) =>
      ridesRepository.rateRide(vars.rideId, vars.input),
    onSuccess: (_data, vars) => refreshAfterRating(queryClient, vars.rideId),
  });
}

/** Omite de forma explícita la calificación y cierra el pendiente en servidor. */
export function useSkipRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.skipRating(rideId),
    onSuccess: (_data, rideId) => refreshAfterRating(queryClient, rideId),
  });
}
