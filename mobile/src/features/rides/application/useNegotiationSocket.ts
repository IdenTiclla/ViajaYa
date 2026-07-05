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
import { usePassengerToasts } from '@/features/booking/application/usePassengerToasts';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { useDriverToasts } from '@/features/driver/application/useDriverToasts';
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
          const isNew = !queryClient
            .getQueryData<Offer[]>(['ride-offers', rideId])
            ?.some((o) => o.id === offer.id);
          queryClient.setQueryData<Offer[]>(['ride-offers', rideId], (prev = []) =>
            prev.some((o) => o.id === offer.id)
              ? prev.map((o) => (o.id === offer.id ? offer : o))
              : [offer, ...prev],
          );
          // Aviso solo de ofertas genuinamente nuevas (las mejoras reemplazan y
          // no deben spamear).
          if (isNew) {
            usePassengerToasts.getState().push({
              kind: 'offer_received',
              rideId,
              title: 'Nueva oferta',
              message: `${offer.driver.fullName}: Bs ${offer.price.toFixed(2)}`,
            });
          }
          break;
        }
        case 'offer_withdrawn': {
          // El conductor retiró/reemplazó su oferta o tomó otro viaje. Si llega
          // `offer_id` quitamos solo esa tarjeta; si no, todas las del conductor.
          // `reason === 'superseded'` = mejora: se quita sin toast (el
          // `offer_created` inmediato ya anuncia el monto nuevo).
          const { driver_id: driverId, offer_id: offerId, reason } = msg.data as {
            driver_id: string;
            offer_id?: string | null;
            reason?: string;
          };
          const existing =
            queryClient.getQueryData<Offer[]>(['ride-offers', rideId]) ?? [];
          const removed = existing.find((o) =>
            offerId ? o.id === offerId : o.driver.id === driverId,
          );
          queryClient.setQueryData<Offer[]>(['ride-offers', rideId], (prev = []) =>
            prev.filter((o) => (offerId ? o.id !== offerId : o.driver.id !== driverId)),
          );
          if (removed && reason !== 'superseded') {
            usePassengerToasts.getState().push({
              kind: 'offer_withdrawn',
              rideId,
              title: 'Oferta retirada',
              message: `${removed.driver.fullName} retiró su oferta.`,
            });
          }
          break;
        }
        case 'offer_expired': {
          // La oferta del conductor venció (30 s) sin respuesta: el backend la
          // emite también al pasajero para retirar la tarjeta en vivo.
          const { offer_id: offerId } = msg.data as {
            offer_id: string;
            ride_id: string;
          };
          const existing =
            queryClient.getQueryData<Offer[]>(['ride-offers', rideId]) ?? [];
          const expired = existing.find((o) => o.id === offerId);
          queryClient.setQueryData<Offer[]>(['ride-offers', rideId], (prev = []) =>
            prev.filter((o) => o.id !== offerId),
          );
          if (expired) {
            usePassengerToasts.getState().push({
              kind: 'offer_expired',
              rideId,
              title: 'Oferta expirada',
              message: `La oferta de ${expired.driver.fullName} expiró.`,
            });
          }
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
          // reemplaza (p. ej. el pasajero aumentó su oferta → nuevo monto, o
          // terminó de modificarla y volvió al pool). En ese segundo caso hay que
          // limpiar `paused` (para que deje de mostrar el banner "El pasajero
          // está modificando su solicitud") y también `dismissed`: si el conductor
          // había descartado la tarjeta, la oferta renovada (monto mayor o datos
          // cambiados) debe reaparecer — el descarte previo ya no aplica.
          const ride = toOpenRide(msg.data as OpenRideDto);
          queryClient.setQueryData<OpenRide[]>(['open-rides'], (prev = []) =>
            prev.some((r) => r.id === ride.id)
              ? prev.map((r) => (r.id === ride.id ? ride : r))
              : [ride, ...prev],
          );
          useDriverRequests.getState().clearPaused(ride.id);
          useDriverRequests.getState().clearDismissed(ride.id);
          break;
        }
        case 'ride_closed': {
          const { ride_id: rideId } = msg.data as { ride_id: string };
          queryClient.setQueryData<OpenRide[]>(['open-rides'], (prev = []) =>
            prev.filter((r) => r.id !== rideId),
          );
          // La solicitud salió del pool: limpia su estado local (sin zombies).
          useDriverRequests.getState().clearRide(rideId);
          break;
        }
        case 'ride_paused': {
          // El pasajero pausó la solicitud para editarla (Modificar). El ride sale
          // del pool (ride_closed) pero al conductor con oferta le llega este
          // evento con el payload completo para que **mantenga** la tarjeta en su
          // lista, marcada como pausada (banner "El pasajero está modificando su
          // solicitud" + solo Quitar) durante la edición. Reemplaza al viejo
          // `offer_rejected(ride_paused)` que no traía los datos y, combinado con
          // el ride_closed, hacía desaparecer la tarjeta durante la edición.
          const ride = toOpenRide(msg.data as OpenRideDto);
          queryClient.setQueryData<OpenRide[]>(['open-rides'], (prev = []) =>
            prev.some((r) => r.id === ride.id)
              ? prev.map((r) => (r.id === ride.id ? ride : r))
              : [ride, ...prev],
          );
          useDriverRequests.getState().markPaused(ride.id);
          useDriverToasts.getState().push({
            kind: 'paused',
            rideId: ride.id,
            title: 'Solicitud en modificación',
            message: 'El pasajero está modificando su solicitud.',
          });
          break;
        }
        case 'offer_accepted': {
          // El pasajero aceptó su oferta: el viaje se le asigna y la pantalla del
          // conductor cambia a navegación. Limpia el estado de esa oferta.
          const ride = toRide(msg.data as RideDto);
          queryClient.setQueryData(['driver-active-ride'], ride);
          useDriverRequests.getState().clearRide(ride.id);
          useDriverToasts.getState().push({
            kind: 'accepted',
            rideId: ride.id,
            title: '¡Viaje confirmado!',
            message: 'El pasajero aceptó tu oferta.',
          });
          break;
        }
        case 'offer_expired': {
          // Su oferta venció (30 s) sin respuesta del pasajero (aviso en vivo).
          const { ride_id: rideId } = msg.data as { ride_id: string };
          useDriverRequests.getState().markExpired(rideId);
          useDriverToasts.getState().push({
            kind: 'expired',
            rideId,
            title: 'Oferta expirada',
            message: 'Pasaron 30 s sin respuesta del pasajero.',
          });
          break;
        }
        case 'offer_rejected': {
          // Su oferta murió. La razón distingue el desenlace para el mensaje correcto.
          const { ride_id: rideId, reason } = msg.data as {
            ride_id: string;
            reason?: string;
          };
          const store = useDriverRequests.getState();
          const toasts = useDriverToasts.getState();
          if (reason === 'ride_taken') {
            store.markTaken(rideId);
            toasts.push({
              kind: 'taken',
              rideId,
              title: 'Viaje tomado',
              message: 'Otro conductor se quedó con este viaje.',
            });
          } else if (reason === 'ride_cancelled') {
            store.markRejected(rideId);
            toasts.push({
              kind: 'cancelled',
              rideId,
              title: 'Viaje cancelado',
              message: 'El pasajero canceló la solicitud.',
            });
          } else {
            store.markRejected(rideId); // declined
            toasts.push({
              kind: 'rejected',
              rideId,
              title: 'Oferta rechazada',
              message: 'El pasajero rechazó tu oferta.',
            });
          }
          break;
        }
        case 'driver_active_ride':
          // Snapshot al reconectar: recupera el viaje activo si lo eligieron con el
          // WS caído.
          queryClient.setQueryData(['driver-active-ride'], toRide(msg.data as RideDto));
          break;
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
