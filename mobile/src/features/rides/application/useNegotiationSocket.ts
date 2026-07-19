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
  flattenOpenRides,
  type OpenRidesInfiniteData,
  openRidesSnapshot,
  prependPausedOpenRides,
  removeOpenRide,
  upsertOpenRide,
} from '@/features/rides/application/openRidesCache';
import {
  DRIVER_ACTIVE_RIDE_KEY,
  PASSENGER_ACTIVE_RIDE_KEY,
} from '@/features/rides/application/useRides';
import { reducePassengerOffers } from '@/features/rides/application/passengerOffersReducer';
import {
  isTerminalRide,
  reduceDriverActiveRide,
  reducePassengerActiveRide,
  shouldApplyRideStatus,
} from '@/features/rides/application/rideStatusReducer';
import { writeRealtimeQueryData } from '@/features/rides/application/realtimeQueryCache';
import { formatBolivianos } from '@/features/rides/domain/money';
import {
  type OfferDto,
  toOffer,
  toOpenRide,
  toOpenRidePage,
  toRide,
} from '@/features/rides/data/ridesRepository';
import {
  driverSocketMessageSchema,
  passengerSocketMessageSchema,
} from '@/features/rides/data/realtimeSchemas';
import type { Offer, Ride } from '@/features/rides/domain/types';

/** Pasajero: recibe en vivo las ofertas y los cambios de estado de su viaje. */
export function useNegotiationSocket(rideId: string | null, enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !rideId) return;

    const handle = openSocket(`/ws/rides/${rideId}`, async (msg) => {
      switch (msg.type) {
        case 'offers_snapshot':
          // Un GET iniciado antes del snapshot no puede resolver despues y
          // restaurar una lista anterior.
          await writeRealtimeQueryData<Offer[]>(
            queryClient,
            ['ride-offers', rideId],
            reducePassengerOffers([], {
              type: 'snapshot',
              offers: msg.data.map(toOffer),
            }).offers,
          );
          break;
        case 'offer_created': {
          // Nueva oferta o el conductor mejoró la suya: upsert por id.
          const offer = toOffer(msg.data);
          const effect = { received: false };
          await writeRealtimeQueryData<Offer[]>(
            queryClient,
            ['ride-offers', rideId],
            (currentOffers = []) => {
              const reduction = reducePassengerOffers(currentOffers, {
                type: 'created',
                offer,
              });
              effect.received = reduction.notice?.kind === 'received';
              return reduction.offers;
            },
          );
          // No repite el aviso si el backend reenvia exactamente la misma oferta.
          if (effect.received) {
            usePassengerToasts.getState().push({
              kind: 'offer_received',
              rideId,
              title: 'Nueva oferta',
              message: `${offer.driver.fullName}: Bs ${formatBolivianos(offer.price)}`,
            });
          }

          // La oferta prueba que esta negociacion sigue vigente. Si el refetch de
          // `/me/active` aun no convergio (o dejo un `null` transitorio), conserva
          // el canal y el flujo con el detalle del ride ya cargado por Offers.
          const cachedRide = queryClient.getQueryData<Ride>(['ride', rideId]);
          if (cachedRide && !isTerminalRide(cachedRide)) {
            await queryClient.cancelQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY });
            queryClient.setQueryData<Ride | null>(
              PASSENGER_ACTIVE_RIDE_KEY,
              (current) =>
                current == null || current.id === cachedRide.id ? cachedRide : current,
            );
          }
          break;
        }
        case 'offer_withdrawn': {
          // El conductor retiro su oferta o tomo otro viaje. Si llega `offer_id`
          // quitamos solo esa tarjeta; si no, todas las del conductor. Una mejora
          // (`superseded`) se procesa de forma atomica al llegar `offer_created`.
          const { driver_id: driverId, offer_id: offerId, reason } = msg.data;
          if (reason === 'superseded') {
            await queryClient.cancelQueries({
              queryKey: ['ride-offers', rideId],
              exact: true,
            });
            break;
          }
          const effect: { removed: Offer | null } = { removed: null };
          await writeRealtimeQueryData<Offer[]>(
            queryClient,
            ['ride-offers', rideId],
            (existing = []) => {
              const reduction = reducePassengerOffers(existing, {
                type: 'withdrawn',
                driverId,
                offerId,
                reason: reason === 'driver_offline' ? reason : undefined,
              });
              effect.removed =
                reduction.notice?.kind === 'withdrawn'
                  ? reduction.notice.offer
                  : null;
              return reduction.offers;
            },
          );
          if (effect.removed) {
            usePassengerToasts.getState().push({
              kind: 'offer_withdrawn',
              rideId,
              title: 'Oferta retirada',
              message: `${effect.removed.driver.fullName} retiró su oferta.`,
            });
          }
          break;
        }
        case 'offer_expired': {
          // La oferta del conductor venció (30 s) sin respuesta: el backend la
          // emite también al pasajero para retirar la tarjeta en vivo.
          const { offer_id: offerId } = msg.data;
          const effect: { expired: Offer | null } = { expired: null };
          await writeRealtimeQueryData<Offer[]>(
            queryClient,
            ['ride-offers', rideId],
            (existing = []) => {
              const reduction = reducePassengerOffers(existing, {
                type: 'expired',
                offerId,
              });
              effect.expired =
                reduction.notice?.kind === 'expired'
                  ? reduction.notice.offer
                  : null;
              return reduction.offers;
            },
          );
          if (effect.expired) {
            usePassengerToasts.getState().push({
              kind: 'offer_expired',
              rideId,
              title: 'Oferta expirada',
              message: `La oferta de ${effect.expired.driver.fullName} expiró.`,
            });
          }
          break;
        }
        case 'ride_status': {
          const ride = toRide(msg.data);
          await Promise.all([
            queryClient.cancelQueries({ queryKey: ['ride', rideId] }),
            queryClient.cancelQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY }),
          ]);
          const cachedRide = queryClient.getQueryData<Ride>(['ride', rideId]);
          const activeRide = queryClient.getQueryData<Ride | null>(
            PASSENGER_ACTIVE_RIDE_KEY,
          );

          // Ninguna de las dos proyecciones puede retroceder. Esto protege tanto
          // eventos fuera de orden como respuestas HTTP que sigan en vuelo.
          if (
            !shouldApplyRideStatus(cachedRide, ride) ||
            !shouldApplyRideStatus(activeRide, ride)
          ) {
            break;
          }

          queryClient.setQueryData(['ride', rideId], ride);
          queryClient.setQueryData<Ride | null>(
            PASSENGER_ACTIVE_RIDE_KEY,
            (current) => reducePassengerActiveRide(current, ride),
          );
          break;
        }
        default:
          break;
      }
    }, passengerSocketMessageSchema);

    return () => handle.close();
  }, [enabled, rideId, queryClient]);
}

/** Conductor: recibe en vivo las solicitudes del pool y el aviso de ser elegido. */
export function useDriverPoolSocket(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const handle = openSocket('/ws/driver', async (msg) => {
      switch (msg.type) {
        case 'open_rides_snapshot':
          // Al volver de segundo plano el conductor puede perder el
          // `ride_created` que anuncia una renovación de la solicitud. Solo
          // borramos el aviso de expiración si la tarifa actual es mayor que la
          // que el pasajero ofrecía cuando el conductor envió esa propuesta.
          const openRidesPage = toOpenRidePage(msg.data);
          const openRides = openRidesPage.items;
          await writeRealtimeQueryData<OpenRidesInfiniteData>(
            queryClient,
            ['open-rides'],
            openRidesSnapshot(openRidesPage),
          );
          const driverRequests = useDriverRequests.getState();
          for (const ride of openRides) {
            // Una solicitud presente en el pool ya terminó de editarse. Esto
            // recupera el `ride_created` que pudo perderse mientras el
            // conductor estaba en segundo plano.
            driverRequests.clearPaused(ride.id);
            // El servidor solo incluye la solicitud si no fue ocultada en
            // esta versión; al aparecer aquí, cualquier descarte local es de
            // una versión anterior.
            driverRequests.clearDismissedBefore(ride.id, ride.poolVersion);
            const expiredFare = driverRequests.expiredFares[ride.id];
            if (expiredFare != null && ride.fare > expiredFare) {
              driverRequests.clearExpired(ride.id);
              driverRequests.clearRejected(ride.id);
            }
          }
          break;
        case 'driver_offers_snapshot': {
          const offers = (msg.data as OfferDto[]).map(toOffer);
          // El handshake entrega primero las solicitudes (abiertas y pausadas),
          // por lo que aquí ya conocemos la tarifa del pasajero. No se debe usar
          // `offer.price`: en una contraoferta es el monto del conductor y rompería
          // la detección de una solicitud renovada después de expirar.
          const currentRides =
            flattenOpenRides(
              queryClient.getQueryData<OpenRidesInfiniteData>(['open-rides']),
            );
          const rideFares = new Map(
            currentRides.map((ride) => [ride.id, ride.fare]),
          );
          const currentOffers = useDriverRequests.getState().offered;
          useDriverRequests.getState().reconcileOffered(
            offers.map((offer) => ({
              rideId: offer.rideId,
              id: offer.id,
              price: offer.price,
              // El fallback previo conserva el dato correcto durante una
              // reconexión excepcional sin snapshot de la solicitud.
              rideFare:
                rideFares.get(offer.rideId) ??
                currentOffers[offer.rideId]?.rideFare ??
                offer.price,
              etaMin: offer.etaMin,
              expiresAt: offer.expiresAt,
            })),
          );
          break;
        }
        case 'paused_rides_snapshot': {
          // Recupera el aviso que habría llegado como `ride_paused` si el
          // conductor estaba fuera de la app durante la edición.
          const pausedRides = msg.data.map(toOpenRide);
          await writeRealtimeQueryData<OpenRidesInfiniteData>(
            queryClient,
            ['open-rides'],
            (prev) => prependPausedOpenRides(prev, pausedRides),
          );
          for (const ride of pausedRides) {
            useDriverRequests.getState().markPaused(ride.id);
          }
          break;
        }
        case 'ride_created': {
          // Upsert: una solicitud nueva se antepone; una ya conocida se
          // reemplaza (p. ej. el pasajero aumentó su oferta → nuevo monto, o
          // terminó de modificarla y volvió al pool). En ese segundo caso hay que
          // resetear el estado local del conductor sobre esa tarjeta, porque los
          // desenlaces previos caducan al renovarse la solicitud:
          // - `paused`: deja de mostrar "El pasajero está modificando su solicitud".
          // - `dismissed`: si la había descartado, la oferta renovada reaparece.
          // - `expired`/`rejected`: la oferta PREVIA del conductor (que venció o fue
          //   rechazada) ya no aplica al nuevo contexto (monto mayor o datos
          //   cambiados); sin esto, la tarjeta seguiría mostrando "Tu oferta expiró"
          //   / "Tu oferta fue rechazada" sobre un precio que el conductor nunca
          //   ofertó. No se toca `offered` (oferta viva) ni `taken`.
          const ride = toOpenRide(msg.data);
          await writeRealtimeQueryData<OpenRidesInfiniteData>(
            queryClient,
            ['open-rides'],
            (prev) => upsertOpenRide(prev, ride),
          );
          useDriverRequests.getState().clearPaused(ride.id);
          useDriverRequests.getState().clearDismissedBefore(ride.id, ride.poolVersion);
          useDriverRequests.getState().clearExpired(ride.id);
          useDriverRequests.getState().clearRejected(ride.id);
          break;
        }
        case 'ride_closed': {
          const { ride_id: rideId } = msg.data;
          await writeRealtimeQueryData<OpenRidesInfiniteData>(
            queryClient,
            ['open-rides'],
            (prev) => removeOpenRide(prev, rideId),
          );
          // Solo quita la oferta visible. El desenlace personal puede llegar
          // antes o después desde otro stream y debe conservar su tombstone.
          useDriverRequests.getState().withdrawOffered([rideId]);
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
          const ride = toOpenRide(msg.data);
          await writeRealtimeQueryData<OpenRidesInfiniteData>(
            queryClient,
            ['open-rides'],
            (prev) => prependPausedOpenRides(prev, [ride]),
          );
          const applied = useDriverRequests
            .getState()
            .markPaused(ride.id, msg.data.offer_id);
          if (applied) {
            useDriverToasts.getState().push({
              kind: 'paused',
              rideId: ride.id,
              title: 'Solicitud en modificación',
              message: 'El pasajero está modificando su solicitud.',
            });
          }
          break;
        }
        case 'offer_accepted': {
          // El pasajero aceptó su oferta: el viaje se le asigna y la pantalla del
          // conductor cambia a navegación. Limpia el estado de esa oferta.
          const ride = toRide(msg.data);
          await queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY });
          queryClient.setQueryData(DRIVER_ACTIVE_RIDE_KEY, ride);
          if (useDriverRequests.getState().markAssigned(ride.id)) {
            useDriverToasts.getState().push({
              kind: 'accepted',
              rideId: ride.id,
              title: '¡Viaje confirmado!',
              message: 'El pasajero aceptó tu oferta.',
            });
          }
          break;
        }
        case 'offer_expired': {
          // Su oferta venció (30 s) sin respuesta del pasajero (aviso en vivo).
          const { ride_id: rideId, offer_id: offerId } = msg.data;
          const applied = useDriverRequests
            .getState()
            .markExpired(rideId, offerId);
          if (!applied) break;
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
          const { ride_id: rideId, offer_id: offerId, reason } = msg.data;
          const store = useDriverRequests.getState();
          const toasts = useDriverToasts.getState();
          if (reason === 'ride_taken') {
            if (store.markTaken(rideId, offerId ?? undefined)) {
              toasts.push({
                kind: 'taken',
                rideId,
                title: 'Viaje tomado',
                message: 'Otro conductor se quedó con este viaje.',
              });
            }
          } else if (reason === 'ride_cancelled') {
            if (store.markCancelled(rideId, offerId ?? undefined)) {
              toasts.push({
                kind: 'cancelled',
                rideId,
                title: 'Viaje cancelado',
                message: 'El pasajero canceló la solicitud.',
              });
            }
          } else {
            if (store.markRejected(rideId, offerId ?? undefined)) {
              toasts.push({
                kind: 'rejected',
                rideId,
                title: 'Oferta rechazada',
                message: 'El pasajero rechazó tu oferta.',
              });
            }
          }
          break;
        }
        case 'driver_active_ride': {
          // Snapshot al reconectar: recupera el viaje activo si lo eligieron con el
          // WS caído.
          const ride = toRide(msg.data);
          await queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY });
          queryClient.setQueryData(DRIVER_ACTIVE_RIDE_KEY, ride);
          useDriverRequests.getState().markAssigned(ride.id);
          break;
        }
        case 'offers_withdrawn': {
          // Ganó otro viaje o pasó offline: el backend retiró todas sus ofertas
          // pendientes conocidas. Un resumen atrasado no debe borrar ofertas de
          // otros rides que se hayan creado después.
          useDriverRequests.getState().withdrawOffered(msg.data.ride_ids);
          void queryClient.invalidateQueries({ queryKey: ['open-rides'] });
          break;
        }
        case 'ride_status': {
          // Cambios del viaje asignado que no inició él (p. ej. el pasajero
          // canceló): refleja el estado en su viaje activo al instante. La
          // pantalla del conductor decide cuándo limpiar el terminal, después de
          // mostrar cancelación o calificación.
          const ride = toRide(msg.data);
          await Promise.all([
            queryClient.cancelQueries({ queryKey: ['ride', ride.id] }),
            queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY }),
          ]);
          const cachedRide = queryClient.getQueryData<Ride>(['ride', ride.id]);
          const activeRide = queryClient.getQueryData<Ride | null>(
            DRIVER_ACTIVE_RIDE_KEY,
          );
          if (
            !shouldApplyRideStatus(cachedRide, ride) ||
            !shouldApplyRideStatus(activeRide, ride)
          ) {
            break;
          }
          queryClient.setQueryData<Ride | null>(DRIVER_ACTIVE_RIDE_KEY, (prev) =>
            reduceDriverActiveRide(prev, ride),
          );
          queryClient.setQueryData(['ride', ride.id], ride);
          break;
        }
        default:
          break;
      }
    }, driverSocketMessageSchema);

    return () => handle.close();
  }, [enabled, queryClient]);
}
