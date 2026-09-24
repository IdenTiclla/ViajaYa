/**
 * WebSocket → React Query bridges of the negotiation flow.
 *
 * Backend events (`offer_created`, `offer_withdrawn`, `ride_status`,
 * `ride_created`, `ride_closed`, `offer_accepted`, …) **mutate the React Query
 * cache**. This way screens keep reading from their query hooks
 * (`useRideOffers`, `useRide`, `useOpenRides`, `useDriverActiveRide`) and
 * update instantly, while polling remains only as a fallback.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { recordRealtimeDiagnostic } from '@/core/realtime/diagnostics';
import { createReplayGate } from '@/core/realtime/replayGate';
import { openSocket, type SocketHandle } from '@/core/realtime/socket';
import { usePassengerToasts } from '@/features/booking/application/usePassengerToasts';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { useDriverToasts } from '@/features/driver/application/useDriverToasts';
import {
  flattenOpenRides,
  type OpenRidesInfiniteData,
  prependPausedOpenRides,
  removeOpenRide,
  upsertOpenRide,
  versionedOpenRidesSnapshot,
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
import {
  createRealtimeReplayConsumer,
  type RealtimeConnectionGuard,
  type RealtimeProtocolClassification,
} from '@/features/rides/application/realtimeReplayConsumer';
import {
  applyDriverRealtimeSnapshot,
  applyPassengerRealtimeSnapshot,
} from '@/features/rides/application/realtimeSnapshots';
import { formatBolivianos } from '@/features/rides/domain/money';
import {
  type OfferDto,
  toOffer,
  toOpenRide,
  toOpenRidePage,
  toRide,
} from '@/features/rides/data/ridesRepository';
import {
  driverRealtimeMessageParser,
  isVersionedSocketMessage,
  passengerRealtimeMessageParser,
  toReplayEventMetadata,
  toReplayStreamCheckpoints,
  type DriverRealtimeMessage,
  type PassengerRealtimeMessage,
} from '@/features/rides/data/realtimeSchemas';
import type { ServiceType } from '@/features/booking/domain/types';
import type { Offer, OpenRide, Ride } from '@/features/rides/domain/types';
import { useAuthStore } from '@/store/authStore';

/** Passenger: receives the offers and status changes of their ride live. */
export function useNegotiationSocket(rideId: string | null, enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !rideId) return;

    const applyMessage = async (
      msg: PassengerRealtimeMessage,
      guard: RealtimeConnectionGuard,
    ) => {
      let postCommitEffect: (() => void) | undefined;
      switch (msg.type) {
        case 'offers_snapshot':
          // A GET started before the snapshot cannot resolve afterwards and
          // restore an older list.
          await writeRealtimeQueryData<Offer[]>(
            queryClient,
            ['ride-offers', rideId],
            reducePassengerOffers([], {
              type: 'snapshot',
              offers: msg.data.map(toOffer),
            }).offers,
            guard.isCurrent,
          );
          break;
        case 'offer_created': {
          // New offer or the driver improved theirs: upsert by id.
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
            guard.isCurrent,
          );
          if (!guard.isCurrent()) break;
          // Do not repeat the notice if the backend resends exactly the same offer.
          if (effect.received) {
            postCommitEffect = () =>
              usePassengerToasts.getState().push({
                kind: 'offer_received',
                rideId,
                title: 'Nueva oferta',
                message: `${offer.driver.fullName}: Bs ${formatBolivianos(offer.price)}`,
              });
          }

          // The offer proves this negotiation is still current. If the `/me/active`
          // refetch has not converged yet (or left a transient `null`), keep
          // the channel and the flow with the ride detail Offers already loaded.
          const cachedRide = queryClient.getQueryData<Ride>(['ride', rideId]);
          if (cachedRide && !isTerminalRide(cachedRide)) {
            await queryClient.cancelQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY });
            if (!guard.isCurrent()) break;
            queryClient.setQueryData<Ride | null>(
              PASSENGER_ACTIVE_RIDE_KEY,
              (current) =>
                current == null || current.id === cachedRide.id ? cachedRide : current,
            );
          }
          break;
        }
        case 'offer_withdrawn': {
          // The driver withdrew their offer or took another ride. If `offer_id` arrives
          // we remove only that card; otherwise, all of that driver's. An improvement
          // (`superseded`) is processed atomically when `offer_created` arrives.
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
            guard.isCurrent,
          );
          if (effect.removed) {
            const removed = effect.removed;
            postCommitEffect = () =>
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
          // The driver's offer expired (30 s) without an answer: the backend
          // also emits it to the passenger to remove the card live.
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
            guard.isCurrent,
          );
          if (effect.expired) {
            const expired = effect.expired;
            postCommitEffect = () =>
              usePassengerToasts.getState().push({
                kind: 'offer_expired',
                rideId,
                title: 'Oferta expirada',
                message: `La oferta de ${expired.driver.fullName} expiró.`,
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
          if (!guard.isCurrent()) break;
          const cachedRide = queryClient.getQueryData<Ride>(['ride', rideId]);
          const activeRide = queryClient.getQueryData<Ride | null>(
            PASSENGER_ACTIVE_RIDE_KEY,
          );

          // Neither projection can go backwards. This protects against both
          // out-of-order events and HTTP responses still in flight.
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
      return postCommitEffect;
    };

    const gate = createReplayGate();
    let handle: SocketHandle | null = null;
    const consumer = createRealtimeReplayConsumer<PassengerRealtimeMessage>({
      gate,
      classify: (message): RealtimeProtocolClassification => {
        if (!isVersionedSocketMessage(message)) {
          return message.type === 'offers_snapshot'
            ? { protocol: 'legacy', kind: 'snapshot', completesHandshake: true }
            : { protocol: 'legacy', kind: 'event' };
        }
        return message.kind === 'snapshot'
          ? {
              protocol: 'v2',
              kind: 'snapshot',
              checkpoints: toReplayStreamCheckpoints(message),
              requiredStreams: [`ride:${rideId}`],
            }
          : {
              protocol: 'v2',
              kind: 'event',
              metadata: toReplayEventMetadata(message),
            };
      },
      applyLegacy: applyMessage,
      applyEvent: applyMessage,
      applySnapshot: async (message, guard) => {
        if (
          !isVersionedSocketMessage(message) ||
          message.kind !== 'snapshot' ||
          message.type !== 'ride_snapshot'
        ) {
          throw new Error('Snapshot de pasajero inválido.');
        }
        await applyPassengerRealtimeSnapshot(
          queryClient,
          PASSENGER_ACTIVE_RIDE_KEY,
          {
            ride: toRide(message.data.ride),
            offers: message.data.offers.map(toOffer),
          },
          guard.isCurrent,
        );
      },
      onResync: (reason) => {
        recordRealtimeDiagnostic({
          kind: 'resync',
          scope: 'passenger',
          reason,
        });
        handle?.resync();
      },
    });
    handle = openSocket(
      `/ws/rides/${rideId}`,
      async (message, socketGuard) => {
        const result = await consumer.consume(message, socketGuard);
        if (result.kind === 'dropped') {
          recordRealtimeDiagnostic({
            kind: 'dropped',
            scope: 'passenger',
            reason: result.reason,
          });
        } else if (
          result.kind === 'applied' &&
          isVersionedSocketMessage(message) &&
          message.kind === 'snapshot'
        ) {
          recordRealtimeDiagnostic({
            kind: 'snapshot_applied',
            scope: 'passenger',
          });
        }
      },
      passengerRealtimeMessageParser,
      {
        onConnection: () => {
          recordRealtimeDiagnostic({
            kind: 'connected',
            scope: 'passenger',
          });
          consumer.beginConnection();
        },
        onClose: (close) => {
          recordRealtimeDiagnostic({
            kind: 'closed',
            scope: 'passenger',
            ...close,
          });
        },
        onInvalidFrame: (issue) => {
          recordRealtimeDiagnostic({
            kind: 'invalid_frame',
            scope: 'passenger',
            frameType: issue.type,
            path: issue.path,
          });
          recordRealtimeDiagnostic({
            kind: 'resync',
            scope: 'passenger',
            reason: 'invalid_frame',
          });
          consumer.invalidateConnection();
          handle?.resync();
        },
        onHandlerError: () => {
          recordRealtimeDiagnostic({
            kind: 'handler_error',
            scope: 'passenger',
          });
          recordRealtimeDiagnostic({
            kind: 'resync',
            scope: 'passenger',
            reason: 'handler_error',
          });
          consumer.invalidateConnection();
          handle?.resync();
        },
      },
    );

    return () => {
      consumer.invalidateConnection();
      handle?.close();
    };
  }, [enabled, rideId, queryClient]);
}

const EMPTY_SERVICES: readonly ServiceType[] = [];

/** Driver: receives the pool's requests and the notice of being chosen live. */
export function useDriverPoolSocket(enabled = true): void {
  const queryClient = useQueryClient();
  const driverId = useAuthStore((state) => state.user?.id ?? null);
  const vehicleType = useAuthStore((state) => state.user?.vehicleType ?? null);
  const driverServices = useAuthStore((state) => state.user?.driverServices ?? EMPTY_SERVICES);
  // A new array each render would reopen the socket; key the effect by content.
  const servicesKey = driverServices.join(',');
  const realtimeResyncSequence = useDriverRequests(
    (state) => state.realtimeResyncSequence,
  );

  useEffect(() => {
    if (!enabled || !driverId || !vehicleType || servicesKey === '') return;
    const driverServices = servicesKey.split(',') as ServiceType[];

    const applyMessage = async (
      msg: DriverRealtimeMessage,
      guard: RealtimeConnectionGuard,
    ) => {
      let postCommitEffect: (() => void) | undefined;
      switch (msg.type) {
        case 'open_rides_snapshot': {
          // The snapshot is authoritative for the content of this cut/page,
          // but absence is not interpreted as a close: the pool is paginated.
          // Also, an item does not downgrade a newer local version.
          const openRidesPage = toOpenRidePage(msg.data);
          const openRides = openRidesPage.items;
          await queryClient.cancelQueries({
            queryKey: ['open-rides'],
            exact: true,
          });
          if (!guard.isCurrent()) break;
          const driverRequests = useDriverRequests.getState();
          const preserveRideIds = new Set<string>();
          for (const ride of openRides) {
            const reduction = driverRequests.applyPoolEvent({
              rideId: ride.id,
              poolVersion: ride.poolVersion,
              phase: 'open',
            });
            if (!reduction.acceptsPayload) preserveRideIds.add(ride.id);
          }
          queryClient.setQueryData<OpenRidesInfiniteData>(
            ['open-rides'],
            (prev) =>
              versionedOpenRidesSnapshot(prev, openRidesPage, preserveRideIds),
          );
          break;
        }
        case 'driver_offers_snapshot': {
          const driverRequests = useDriverRequests.getState();
          const offerCut = driverRequests.beginOfferSnapshot();
          const offers = (msg.data as OfferDto[]).map(toOffer);
          // The handshake delivers the requests first (open and paused),
          // so here we already know the passenger's fare. `offer.price` must not
          // be used: in a counter-offer it is the driver's amount and would break
          // the detection of a request renewed after expiring.
          const currentRides =
            flattenOpenRides(
              queryClient.getQueryData<OpenRidesInfiniteData>(['open-rides']),
            );
          const rideFares = new Map(
            currentRides.map((ride) => [ride.id, ride.fare]),
          );
          const currentOffers = driverRequests.offered;
          driverRequests.reconcileOffered(
            offers.map((offer) => ({
              rideId: offer.rideId,
              id: offer.id,
              price: offer.price,
              // The previous fallback keeps the correct value during an
              // exceptional reconnection without the request's snapshot.
              rideFare:
                rideFares.get(offer.rideId) ??
                currentOffers[offer.rideId]?.rideFare ??
                offer.price,
              etaMin: offer.etaMin,
              expiresAt: offer.expiresAt,
            })),
            offerCut,
          );
          break;
        }
        case 'paused_rides_snapshot': {
          // Recover the notice that would have arrived as `ride_paused` if the
          // driver was out of the app during the edit.
          const pausedRides = msg.data.map(toOpenRide);
          const acceptedPausedRides: OpenRide[] = [];
          await queryClient.cancelQueries({
            queryKey: ['open-rides'],
            exact: true,
          });
          if (!guard.isCurrent()) break;
          const driverRequests = useDriverRequests.getState();
          for (const ride of pausedRides) {
            const reduction = driverRequests.applyPoolEvent({
              rideId: ride.id,
              poolVersion: ride.poolVersion,
              phase: 'paused',
            });
            if (reduction.acceptsPayload) acceptedPausedRides.push(ride);
            if (reduction.applied) driverRequests.markPaused(ride.id);
          }
          queryClient.setQueryData<OpenRidesInfiniteData>(
            ['open-rides'],
            (prev) => prependPausedOpenRides(prev, acceptedPausedRides),
          );
          break;
        }
        case 'ride_created': {
          const ride = toOpenRide(msg.data);
          await queryClient.cancelQueries({
            queryKey: ['open-rides'],
            exact: true,
          });
          if (!guard.isCurrent()) break;
          const reduction = useDriverRequests.getState().applyPoolEvent({
            rideId: ride.id,
            poolVersion: ride.poolVersion,
            phase: 'open',
          });
          // An open duplicate can refresh public data without clearing
          // outcomes. A late one, or the same version already closed/paused, cannot
          // revive the card.
          if (!reduction.acceptsPayload) break;
          queryClient.setQueryData<OpenRidesInfiniteData>(
            ['open-rides'],
            (prev) => upsertOpenRide(prev, ride),
          );
          break;
        }
        case 'ride_closed': {
          const {
            ride_id: rideId,
            pool_version: poolVersion,
            reason,
          } = msg.data;
          // Temporary compatibility with legacy producers. Without both fields there
          // is no safe way to order the close, so it keeps the previous
          // best-effort behavior until the rollout is complete.
          if (poolVersion == null || reason == null) {
            await writeRealtimeQueryData<OpenRidesInfiniteData>(
              queryClient,
              ['open-rides'],
              (prev) => removeOpenRide(prev, rideId),
              guard.isCurrent,
            );
            if (!guard.isCurrent()) break;
            useDriverRequests.getState().withdrawOffered([rideId]);
            break;
          }
          await queryClient.cancelQueries({
            queryKey: ['open-rides'],
            exact: true,
          });
          if (!guard.isCurrent()) break;
          const reduction = useDriverRequests.getState().applyPoolEvent({
            rideId,
            poolVersion,
            phase: reason === 'terminal' ? 'terminal' : 'closed',
          });
          if (!reduction.applied) break;
          queryClient.setQueryData<OpenRidesInfiniteData>(
            ['open-rides'],
            (prev) => removeOpenRide(prev, rideId),
          );
          // Only remove the visible offer. The personal outcome may arrive
          // before or after from another stream and must keep its tombstone.
          useDriverRequests.getState().withdrawOffered([rideId]);
          break;
        }
        case 'ride_paused': {
          // The passenger paused the request to edit it (Modify). The ride leaves
          // the pool (ride_closed) but the driver with an offer receives this
          // event with the full payload so they **keep** the card in their
          // list, marked as paused (banner "El pasajero está modificando su
          // solicitud" + only Remove) during the edit. It replaces the old
          // `offer_rejected(ride_paused)`, which carried no data and, combined with
          // ride_closed, made the card disappear during the edit.
          const ride = toOpenRide(msg.data);
          await queryClient.cancelQueries({
            queryKey: ['open-rides'],
            exact: true,
          });
          if (!guard.isCurrent()) break;
          const driverRequests = useDriverRequests.getState();
          const reduction = driverRequests.applyPoolEvent({
            rideId: ride.id,
            poolVersion: ride.poolVersion,
            phase: 'paused',
          });
          if (!reduction.applied) {
            // The pause may belong to an earlier generation and must not
            // downgrade the current card. Its offer_id is still useful: it seals
            // the withdrawn offer and invalidates a late HTTP 201 for that offer,
            // without deleting a later re-offer with a different identity.
            driverRequests.markWithdrawn(ride.id, msg.data.offer_id);
            break;
          }
          queryClient.setQueryData<OpenRidesInfiniteData>(
            ['open-rides'],
            (prev) => prependPausedOpenRides(prev, [ride]),
          );
          const applied = driverRequests.markPaused(ride.id, msg.data.offer_id);
          if (applied) {
            postCommitEffect = () =>
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
          // The passenger accepted their offer: the ride is assigned to them and the
          // driver's screen switches to navigation. Clear that offer's state.
          const ride = toRide(msg.data);
          await queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY });
          if (!guard.isCurrent()) break;
          queryClient.setQueryData(DRIVER_ACTIVE_RIDE_KEY, ride);
          if (useDriverRequests.getState().markAssigned(ride.id)) {
            postCommitEffect = () =>
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
          // Their offer expired (30 s) without an answer from the passenger (live notice).
          const { ride_id: rideId, offer_id: offerId } = msg.data;
          const applied = useDriverRequests
            .getState()
            .markExpired(rideId, offerId);
          if (!applied) break;
          postCommitEffect = () =>
            useDriverToasts.getState().push({
              kind: 'expired',
              rideId,
              title: 'Oferta expirada',
              message: 'Pasaron 30 s sin respuesta del pasajero.',
            });
          break;
        }
        case 'offer_rejected': {
          // Their offer died. The reason tells the outcome apart for the right message.
          const { ride_id: rideId, offer_id: offerId, reason } = msg.data;
          const store = useDriverRequests.getState();
          if (reason === 'ride_taken') {
            if (store.markTaken(rideId, offerId ?? undefined)) {
              postCommitEffect = () =>
                useDriverToasts.getState().push({
                  kind: 'taken',
                  rideId,
                  title: 'Viaje tomado',
                  message: 'Otro conductor se quedó con este viaje.',
                });
            }
          } else if (reason === 'ride_cancelled') {
            if (store.markCancelled(rideId, offerId ?? undefined)) {
              postCommitEffect = () =>
                useDriverToasts.getState().push({
                  kind: 'cancelled',
                  rideId,
                  title: 'Viaje cancelado',
                  message: 'El pasajero canceló la solicitud.',
                });
            }
          } else {
            if (store.markRejected(rideId, offerId ?? undefined)) {
              postCommitEffect = () =>
                useDriverToasts.getState().push({
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
          // Snapshot on reconnect: recovers the active ride if they were chosen while the
          // WS was down.
          const ride = toRide(msg.data);
          await queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY });
          if (!guard.isCurrent()) break;
          queryClient.setQueryData(DRIVER_ACTIVE_RIDE_KEY, ride);
          useDriverRequests.getState().markAssigned(ride.id);
          break;
        }
        case 'offers_withdrawn': {
          // Another ride won or they went offline: the backend withdrew all their known
          // pending offers. New producers identify each
          // offer: a late summary of A cannot delete a re-offer B on the
          // same ride. `ride_ids` stays as a fallback during the rollout.
          const store = useDriverRequests.getState();
          if (msg.data.offers !== undefined) {
            store.withdrawExactOffers(
              msg.data.offers.map((offer) => ({
                rideId: offer.ride_id,
                offerId: offer.offer_id,
              })),
            );
          } else {
            store.withdrawOffered(msg.data.ride_ids);
          }
          postCommitEffect = () => {
            void queryClient.invalidateQueries({ queryKey: ['open-rides'] });
          };
          break;
        }
        case 'ride_status': {
          // Changes to the assigned ride that they did not start (e.g. the passenger
          // cancelled): reflect the status in their active ride instantly. The
          // driver's screen decides when to clear the terminal status, after
          // showing the cancellation or the rating.
          const ride = toRide(msg.data);
          await Promise.all([
            queryClient.cancelQueries({ queryKey: ['ride', ride.id] }),
            queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY }),
          ]);
          if (!guard.isCurrent()) break;
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
      return postCommitEffect;
    };

    const gate = createReplayGate();
    let handle: SocketHandle | null = null;
    const consumer = createRealtimeReplayConsumer<DriverRealtimeMessage>({
      gate,
      classify: (message): RealtimeProtocolClassification => {
        if (!isVersionedSocketMessage(message)) {
          if (
            message.type === 'open_rides_snapshot' ||
            message.type === 'paused_rides_snapshot' ||
            message.type === 'driver_offers_snapshot' ||
            message.type === 'driver_active_ride'
          ) {
            return {
              protocol: 'legacy',
              kind: 'snapshot',
              completesHandshake: message.type === 'driver_offers_snapshot',
            };
          }
          return { protocol: 'legacy', kind: 'event' };
        }
        return message.kind === 'snapshot'
          ? {
              protocol: 'v2',
              kind: 'snapshot',
              checkpoints: toReplayStreamCheckpoints(message),
              requiredStreams: [
                ...driverServices.map((service) => `pool:${service}`),
                `driver:${driverId}`,
              ],
            }
          : {
              protocol: 'v2',
              kind: 'event',
              metadata: toReplayEventMetadata(message),
            };
      },
      applyLegacy: applyMessage,
      applyEvent: applyMessage,
      applySnapshot: async (message, guard) => {
        if (
          !isVersionedSocketMessage(message) ||
          message.kind !== 'snapshot' ||
          message.type !== 'driver_snapshot'
        ) {
          throw new Error('Snapshot de conductor inválido.');
        }
        await applyDriverRealtimeSnapshot(
          queryClient,
          DRIVER_ACTIVE_RIDE_KEY,
          useDriverRequests.getState(),
          {
            openRides: toOpenRidePage(message.data.open_rides),
            pausedRides: message.data.paused_rides.map(toOpenRide),
            offers: message.data.offers.map(toOffer),
            activeRide:
              message.data.active_ride == null
                ? null
                : toRide(message.data.active_ride),
          },
          guard.isCurrent,
        );
      },
      onResync: (reason) => {
        recordRealtimeDiagnostic({
          kind: 'resync',
          scope: 'driver',
          reason,
        });
        handle?.resync();
      },
    });
    handle = openSocket(
      '/ws/driver',
      async (message, socketGuard) => {
        const result = await consumer.consume(message, socketGuard);
        if (result.kind === 'dropped') {
          recordRealtimeDiagnostic({
            kind: 'dropped',
            scope: 'driver',
            reason: result.reason,
          });
        } else if (
          result.kind === 'applied' &&
          isVersionedSocketMessage(message) &&
          message.kind === 'snapshot'
        ) {
          recordRealtimeDiagnostic({
            kind: 'snapshot_applied',
            scope: 'driver',
          });
        }
      },
      driverRealtimeMessageParser,
      {
        onConnection: () => {
          recordRealtimeDiagnostic({
            kind: 'connected',
            scope: 'driver',
          });
          consumer.beginConnection();
        },
        onClose: (close) => {
          recordRealtimeDiagnostic({
            kind: 'closed',
            scope: 'driver',
            ...close,
          });
        },
        onInvalidFrame: (issue) => {
          recordRealtimeDiagnostic({
            kind: 'invalid_frame',
            scope: 'driver',
            frameType: issue.type,
            path: issue.path,
          });
          recordRealtimeDiagnostic({
            kind: 'resync',
            scope: 'driver',
            reason: 'invalid_frame',
          });
          consumer.invalidateConnection();
          handle?.resync();
        },
        onHandlerError: () => {
          recordRealtimeDiagnostic({
            kind: 'handler_error',
            scope: 'driver',
          });
          recordRealtimeDiagnostic({
            kind: 'resync',
            scope: 'driver',
            reason: 'handler_error',
          });
          consumer.invalidateConnection();
          handle?.resync();
        },
      },
    );

    return () => {
      consumer.invalidateConnection();
      handle?.close();
    };
  }, [
    driverId,
    enabled,
    queryClient,
    realtimeResyncSequence,
    servicesKey,
    vehicleType,
  ]);
}
