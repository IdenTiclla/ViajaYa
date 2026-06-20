/**
 * Hooks de consulta del flujo de viaje (React Query).
 *
 * El tiempo real lo empuja el **WebSocket** (ver `useNegotiationSocket` /
 * `useDriverPoolSocket`), que muta esta misma caché. El `refetchInterval` queda
 * solo como **respaldo lento** por si el socket se cae (resiliencia), no como la
 * vía principal. Las consultas de un viaje concreto dejan de refrescarse cuando
 * el viaje llega a un estado terminal (`completed`/`cancelled`).
 */
import { useQuery } from '@tanstack/react-query';

import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { Offer, OpenRide, Ride } from '@/features/rides/domain/types';

// Respaldo lento: el WebSocket es la vía principal de actualización.
const POLL_OFFERS_MS = 15000;
const POLL_RIDE_MS = 15000;
const POLL_OPEN_MS = 20000;
const POLL_ACTIVE_MS = 20000;

function isTerminal(status: Ride['status'] | undefined): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** Conductor: solicitudes abiertas de su tipo de vehículo. */
export function useOpenRides(enabled = true): { rides: OpenRide[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['open-rides'],
    queryFn: () => ridesRepository.getOpenRides(),
    refetchInterval: enabled ? POLL_OPEN_MS : false,
    enabled,
  });
  return { rides: query.data ?? [], isLoading: query.isPending };
}

/** Pasajero: ofertas pendientes recibidas para su viaje. */
export function useRideOffers(
  rideId: string | null,
  enabled = true,
): { offers: Offer[]; isLoading: boolean } {
  const active = enabled && !!rideId;
  const query = useQuery({
    queryKey: ['ride-offers', rideId],
    queryFn: () => ridesRepository.listOffers(rideId as string),
    refetchInterval: active ? POLL_OFFERS_MS : false,
    enabled: active,
  });
  return { offers: query.data ?? [], isLoading: query.isPending };
}

/** Detalle de un viaje con polling (pasajero o conductor). */
export function useRide(rideId: string | null): { ride: Ride | undefined; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['ride', rideId],
    queryFn: () => ridesRepository.getRide(rideId as string),
    enabled: !!rideId,
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? false : POLL_RIDE_MS),
  });
  return { ride: query.data, isLoading: query.isPending };
}

/** Conductor: viaje activo asignado (para saber si ya fue elegido). */
export function useDriverActiveRide(
  enabled = true,
): { ride: Ride | null; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['driver-active-ride'],
    queryFn: () => ridesRepository.getActiveRide(),
    enabled,
    refetchInterval: enabled ? POLL_ACTIVE_MS : false,
  });
  return { ride: query.data ?? null, isLoading: query.isPending };
}
