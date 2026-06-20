/**
 * Hooks del cierre del viaje: historial, ganancias del conductor y calificación.
 * El historial y las ganancias se consultan con React Query; la calificación es
 * una mutación que invalida el viaje y el historial para reflejar el cambio.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { RatingInput, RideStatus } from '@/features/rides/domain/types';

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
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['ride', vars.rideId] });
      void queryClient.invalidateQueries({ queryKey: ['ride-history'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-earnings'] });
    },
  });
}
