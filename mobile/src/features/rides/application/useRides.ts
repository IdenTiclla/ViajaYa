/**
 * Hooks de consulta del flujo de viaje (React Query).
 *
 * El tiempo real lo empuja el **WebSocket** (ver `useNegotiationSocket` /
 * `useDriverPoolSocket`), que muta esta misma caché. El `refetchInterval` queda
 * solo como **respaldo lento** por si el socket se cae (resiliencia), no como la
 * vía principal. Las consultas de un viaje concreto dejan de refrescarse cuando
 * el viaje llega a un estado terminal (`completed`/`cancelled`).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { Ride } from '@/features/rides/domain/types';

// Respaldo lento: el WebSocket es la vía principal de actualización.
const POLL_OFFERS_MS = 15000;
const POLL_RIDE_MS = 15000;
const POLL_OPEN_MS = 20000;
const POLL_ACTIVE_MS = 20000;

export const PASSENGER_ACTIVE_RIDE_KEY = ['passenger-active-ride'] as const;
export const DRIVER_ACTIVE_RIDE_KEY = ['driver-active-ride'] as const;
export const PENDING_RATING_RIDE_KEY = ['pending-rating-ride'] as const;

function isTerminal(status: Ride['status'] | undefined): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** Conductor: solicitudes abiertas de su tipo de vehículo. */
export function useOpenRides(enabled = true) {
  const query = useQuery({
    queryKey: ['open-rides'],
    queryFn: () => ridesRepository.getOpenRides(),
    refetchInterval: enabled ? POLL_OPEN_MS : false,
    enabled,
  });
  return {
    rides: query.data ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Pasajero: ofertas pendientes recibidas para su viaje. */
export function useRideOffers(
  rideId: string | null,
  enabled = true,
) {
  const active = enabled && !!rideId;
  const query = useQuery({
    queryKey: ['ride-offers', rideId],
    queryFn: () => ridesRepository.listOffers(rideId as string),
    refetchInterval: active ? POLL_OFFERS_MS : false,
    enabled: active,
  });
  return {
    offers: query.data ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Detalle de un viaje con polling (pasajero o conductor). */
export function useRide(rideId: string | null) {
  const query = useQuery({
    queryKey: ['ride', rideId],
    queryFn: () => ridesRepository.getRide(rideId as string),
    enabled: !!rideId,
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? false : POLL_RIDE_MS),
  });
  return {
    ride: query.data,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Pasajero: solicitud o viaje vigente, incluso si esta pausado para editar. */
export function usePassengerActiveRide() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: PASSENGER_ACTIVE_RIDE_KEY,
    queryFn: () => ridesRepository.getPassengerActiveRide(),
    refetchInterval: (q) =>
      isTerminal(q.state.data?.status) ? false : POLL_ACTIVE_MS,
  });

  // El endpoint activo devuelve el mismo contrato que el detalle. Compartirlo
  // evita una segunda carga al recuperar Offers, Configure o Trip.
  useEffect(() => {
    if (query.data) {
      queryClient.setQueryData(['ride', query.data.id], query.data);
    }
  }, [query.data, queryClient]);

  return {
    ride: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Conductor: viaje activo asignado (para saber si ya fue elegido). */
export function useDriverActiveRide(
  enabled = true,
) {
  const query = useQuery({
    queryKey: DRIVER_ACTIVE_RIDE_KEY,
    queryFn: () => ridesRepository.getActiveRide(),
    enabled,
    refetchInterval: (q) =>
      enabled && !isTerminal(q.state.data?.status) ? POLL_ACTIVE_MS : false,
  });
  return {
    ride: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Ambos roles: cierre completado que sigue pendiente de calificacion. */
export function usePendingRatingRide(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: PENDING_RATING_RIDE_KEY,
    queryFn: () => ridesRepository.getPendingRatingRide(),
    enabled,
  });

  useEffect(() => {
    if (query.data) {
      queryClient.setQueryData(['ride', query.data.id], query.data);
    }
  }, [query.data, queryClient]);

  return {
    ride: query.data ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
