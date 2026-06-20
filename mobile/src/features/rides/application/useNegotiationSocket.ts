/**
 * Puentes WebSocket → React Query del flujo de negociación.
 *
 * Los eventos del backend (`offer_created`, `offer_withdrawn`, `ride_status`,
 * `ride_created`, `ride_closed`, `offer_accepted`, …) **mutan la caché** de
 * React Query. Así las pantallas siguen leyendo de sus hooks de consulta
 * (`useRideOffers`, `useRide`, `useOpenRides`, `useDriverActiveRide`) y se
 * actualizan al instante, mientras el polling queda solo como respaldo.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { openSocket } from '@/core/realtime/socket';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import {
  type OfferDto,
  type OpenRideDto,
  type RideDto,
  toOffer,
  toOpenRide,
  toRide,
} from '@/features/rides/data/ridesRepository';
import type { Offer, OpenRide, Ride } from '@/features/rides/domain/types';

/** Pasajero: recibe en vivo las ofertas y los cambios de estado de su viaje. */
export function useNegotiationSocket(rideId: string | null, enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !rideId) return;

    const handle = openSocket(`/ws/rides/${rideId}`, (msg) => {
      switch (msg.type) {
        case 'offers_snapshot':
          queryClient.setQueryData(
            ['ride-offers', rideId],
            (msg.data as OfferDto[]).map(toOffer),
          );
          break;
        case 'offer_created': {
          // Nueva oferta o el conductor mejoró la suya: upsert por id.
          const offer = toOffer(msg.data as OfferDto);
          queryClient.setQueryData<Offer[]>(['ride-offers', rideId], (prev = []) =>
            prev.some((o) => o.id === offer.id)
              ? prev.map((o) => (o.id === offer.id ? offer : o))
              : [offer, ...prev],
          );
          break;
        }
        case 'offer_withdrawn': {
          // El conductor retiró/reemplazó su oferta o tomó otro viaje. Si llega
          // `offer_id` quitamos solo esa tarjeta; si no, todas las del conductor.
          const { driver_id: driverId, offer_id: offerId } = msg.data as {
            driver_id: string;
            offer_id?: string | null;
          };
          queryClient.setQueryData<Offer[]>(['ride-offers', rideId], (prev = []) =>
            prev.filter((o) => (offerId ? o.id !== offerId : o.driver.id !== driverId)),
          );
          break;
        }
        case 'ride_status':
          queryClient.setQueryData(['ride', rideId], toRide(msg.data as RideDto));
          break;
        default:
          break;
      }
    });

    return () => handle.close();
  }, [enabled, rideId, queryClient]);
}

/** Conductor: recibe en vivo las solicitudes del pool y el aviso de ser elegido. */
export function useDriverPoolSocket(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const handle = openSocket('/ws/driver', (msg) => {
      switch (msg.type) {
        case 'open_rides_snapshot':
          queryClient.setQueryData(
            ['open-rides'],
            (msg.data as OpenRideDto[]).map(toOpenRide),
          );
          break;
        case 'ride_created': {
          // Upsert: una solicitud nueva se antepone; una ya conocida se
          // reemplaza (p. ej. el pasajero aumentó su oferta → nuevo monto).
          const ride = toOpenRide(msg.data as OpenRideDto);
          queryClient.setQueryData<OpenRide[]>(['open-rides'], (prev = []) =>
            prev.some((r) => r.id === ride.id)
              ? prev.map((r) => (r.id === ride.id ? ride : r))
              : [ride, ...prev],
          );
          break;
        }
        case 'ride_closed': {
          const { ride_id: rideId } = msg.data as { ride_id: string };
          queryClient.setQueryData<OpenRide[]>(['open-rides'], (prev = []) =>
            prev.filter((r) => r.id !== rideId),
          );
          break;
        }
        case 'offer_accepted':
          // El pasajero aceptó su oferta: el viaje se le asigna y la pantalla del
          // conductor cambia a navegación.
          queryClient.setQueryData(['driver-active-ride'], toRide(msg.data as RideDto));
          break;
        case 'offer_rejected': {
          // Su oferta murió: el pasajero la rechazó (`declined`) u otro
          // conductor confirmó primero (`ride_taken`).
          const { ride_id: rideId, reason } = msg.data as {
            ride_id: string;
            reason?: string;
          };
          if (reason === 'ride_taken') {
            useDriverRequests.getState().markTaken(rideId);
          } else {
            useDriverRequests.getState().markRejected(rideId);
          }
          break;
        }
        case 'offers_withdrawn':
          // Sus otras ofertas se retiraron al ganar otro viaje; refresca el pool.
          void queryClient.invalidateQueries({ queryKey: ['open-rides'] });
          break;
        case 'ride_status': {
          // Cambios del viaje asignado que no inició él (p. ej. el pasajero
          // canceló): refleja el estado en su viaje activo al instante. La
          // pantalla del conductor decide cómo cerrar el flujo (el polling de
          // `driver-active-ride` luego lo deja en null si quedó terminal).
          const ride = toRide(msg.data as RideDto);
          queryClient.setQueryData<Ride | null>(['driver-active-ride'], (prev) =>
            prev && prev.id === ride.id ? ride : prev,
          );
          break;
        }
        default:
          break;
      }
    });

    return () => handle.close();
  }, [enabled, queryClient]);
}
