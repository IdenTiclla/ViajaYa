/**
 * Hooks del cierre del viaje: historial, ganancias del conductor y calificación.
 * El historial y las ganancias se consultan con React Query; la calificación es
 * una mutación que invalida el viaje y el historial para reflejar el cambio.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { actualizarTrasCalificacion } from '@/features/rides/application/actualizarTrasCalificacion';
import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { RatingInput, RideStatus } from '@/features/rides/domain/types';

/** Historial de viajes del usuario (pasajero o conductor), filtrable por estado. */
export function useRideHistory(status?: RideStatus) {
  const query = useInfiniteQuery({
    queryKey: ['ride-history', status ?? 'all'],
    queryFn: ({ pageParam, signal }) =>
      ridesRepository.getHistory(status, pageParam, undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  return {
    ...query,
    data: query.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

/** Resumen de ganancias del conductor (hoy, histórico y viajes recientes). */
export function useDriverEarnings(enabled = true) {
  return useQuery({
    queryKey: ['driver-earnings'],
    queryFn: ({ signal }) => ridesRepository.getEarnings(signal),
    enabled,
  });
}

/** Califica al otro participante tras completarse el viaje. */
export function useRateRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; input: RatingInput }) =>
      ridesRepository.rateRide(vars.rideId, vars.input),
    onSuccess: (_data, vars) => actualizarTrasCalificacion(queryClient, vars.rideId),
  });
}

/** Omite de forma explícita la calificación y cierra el pendiente en servidor. */
export function useSkipRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.skipRating(rideId),
    onSuccess: (_data, rideId) => actualizarTrasCalificacion(queryClient, rideId),
  });
}
