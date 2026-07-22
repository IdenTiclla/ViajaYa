/**
 * Estado de pantalla del conductor sobre las solicitudes abiertas (zustand).
 *
 * Al descartar, el backend guarda la versión de la solicitud para ese conductor.
 * Este store conserva el reflejo inmediato mientras llega la confirmación y evita
 * que un evento WebSocket repetido vuelva a mostrarla.
 *
 * `offered` recuerda la oferta enviada a cada solicitud (id, precio, ETA y
 * expiración 30 s) **mientras siga viva**. Los demás conjuntos marcan el
 * desenlace en vivo por WebSocket:
 * - `rejected`: el pasajero rechazó la oferta (`declined`) o canceló el viaje.
 * - `taken`: otro conductor se llevó el viaje.
 * - `expired`: la oferta venció (30 s) sin respuesta.
 * - `paused`: el pasajero está modificando la solicitud (no se puede ofertar).
 *
 * Los IDs resueltos, los rides terminales y los tokens de intento se conservan
 * de forma acotada: una respuesta HTTP atrasada no recrea `offered[rideId]`.
 * El estado se comparte entre la lista, el mapa y la pantalla de estado.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

/** Datos de la oferta que el conductor envió a una solicitud. */
export type SentOffer = {
  offerId: string;
  price: number;
  /** Tarifa del pasajero cuando se envió la oferta; detecta renovaciones. */
  rideFare: number;
  etaMin: number | null;
  expiresAt: string;
};

const FALLBACK_TTL_MS = 30_000;
const MAX_SETTLED_OFFERS = 512;
const MAX_TERMINAL_RIDES = 256;
const MAX_OFFER_ATTEMPTS = 512;

export type DriverPoolPhase = 'open' | 'closed' | 'paused' | 'terminal';

export type DriverPoolCycle = {
  poolVersion: number;
  phase: DriverPoolPhase;
};

export type DriverPoolProjection = Map<string, DriverPoolCycle>;

export type DriverPoolEvent = {
  rideId: string;
  poolVersion: number;
  phase: DriverPoolPhase;
};

export type DriverPoolReductionKind =
  | 'initial'
  | 'renewed'
  | 'transition'
  | 'duplicate'
  | 'stale'
  | 'superseded';

export type DriverPoolReduction = {
  projection: DriverPoolProjection;
  kind: DriverPoolReductionKind;
  /** El payload puede refrescar la caché sin implicar una transición nueva. */
  acceptsPayload: boolean;
  /** El evento puede mutar la caché y los estados visuales. */
  applied: boolean;
  /** Solo una publicación de versión estrictamente mayor limpia desenlaces. */
  clearsOutcomes: boolean;
};

export const MAX_DRIVER_POOL_CYCLES = 512;

const POOL_PHASE_PRECEDENCE: Record<DriverPoolPhase, number> = {
  open: 0,
  closed: 1,
  paused: 2,
  terminal: 3,
};

function rememberPoolCycle(
  projection: DriverPoolProjection,
  rideId: string,
  cycle: DriverPoolCycle,
): DriverPoolProjection {
  const next = new Map(projection);
  // El orden de inserción funciona como LRU sencillo para acotar tombstones.
  next.delete(rideId);
  next.set(rideId, cycle);
  while (next.size > MAX_DRIVER_POOL_CYCLES) {
    const oldest = next.keys().next().value;
    if (oldest == null) break;
    next.delete(oldest);
  }
  return next;
}

/**
 * Reduce el ciclo visible de una solicitud dentro del pool del conductor.
 *
 * `poolVersion` separa publicaciones reales. Dentro de una misma versión las
 * fases solo avanzan: un cierre puede anteceder a la notificación personal de
 * pausa, pero un `ride_created` repetido no puede reabrir ninguna de las dos.
 */
export function reduceDriverPoolEvent(
  projection: DriverPoolProjection,
  event: DriverPoolEvent,
): DriverPoolReduction {
  const current = projection.get(event.rideId);
  if (!current) {
    return {
      projection: rememberPoolCycle(projection, event.rideId, {
        poolVersion: event.poolVersion,
        phase: event.phase,
      }),
      kind: 'initial',
      acceptsPayload: true,
      applied: true,
      clearsOutcomes: false,
    };
  }

  if (event.poolVersion < current.poolVersion) {
    return {
      projection,
      kind: 'stale',
      acceptsPayload: false,
      applied: false,
      clearsOutcomes: false,
    };
  }

  if (event.poolVersion > current.poolVersion) {
    return {
      projection: rememberPoolCycle(projection, event.rideId, {
        poolVersion: event.poolVersion,
        phase: event.phase,
      }),
      kind: event.phase === 'open' ? 'renewed' : 'transition',
      acceptsPayload: true,
      applied: true,
      clearsOutcomes: event.phase === 'open',
    };
  }

  if (event.phase === current.phase) {
    return {
      projection: rememberPoolCycle(projection, event.rideId, current),
      kind: 'duplicate',
      acceptsPayload: true,
      applied: false,
      clearsOutcomes: false,
    };
  }

  if (
    POOL_PHASE_PRECEDENCE[event.phase] <=
    POOL_PHASE_PRECEDENCE[current.phase]
  ) {
    return {
      projection: rememberPoolCycle(projection, event.rideId, current),
      kind: 'superseded',
      acceptsPayload: false,
      applied: false,
      clearsOutcomes: false,
    };
  }

  return {
    projection: rememberPoolCycle(projection, event.rideId, {
      poolVersion: event.poolVersion,
      phase: event.phase,
    }),
    kind: 'transition',
    acceptsPayload: true,
    applied: true,
    clearsOutcomes: false,
  };
}

function addBounded(set: Set<string>, value: string, limit: number): Set<string> {
  const next = new Set(set);
  next.delete(value);
  next.add(value);
  while (next.size > limit) {
    const oldest = next.values().next().value;
    if (oldest == null) break;
    next.delete(oldest);
  }
  return next;
}

function advanceOfferAttempt(
  sequence: number,
  attempts: Map<string, number>,
  rideId: string,
): { offerAttemptSequence: number; offerAttemptTokens: Map<string, number> } {
  const token = sequence + 1;
  const offerAttemptTokens = new Map(attempts);
  offerAttemptTokens.delete(rideId);
  offerAttemptTokens.set(rideId, token);
  while (offerAttemptTokens.size > MAX_OFFER_ATTEMPTS) {
    const oldest = offerAttemptTokens.keys().next().value;
    if (oldest == null) break;
    offerAttemptTokens.delete(oldest);
  }
  return { offerAttemptSequence: token, offerAttemptTokens };
}

type DriverRequestsState = {
  /** Última versión/fase observada por ride; acota eventos atrasados del pool. */
  poolProjection: DriverPoolProjection;
  /** Versión descartada de cada solicitud; evita revivirla por un WS repetido. */
  dismissed: Map<string, number>;
  offered: Record<string, SentOffer>;
  /** Oferta rechazada por el pasajero, o viaje cancelado. */
  rejected: Set<string>;
  /** Viaje que otro conductor se llevó. */
  taken: Set<string>;
  /** Oferta que venció (30 s) sin respuesta del pasajero. */
  expired: Set<string>;
  /** Tarifa vigente al expirar cada oferta; persiste el contexto para reconexión. */
  expiredFares: Record<string, number>;
  /** Solicitud pausada por el pasajero (modificándola). */
  paused: Set<string>;
  /** IDs terminales conservados para descartar respuestas HTTP atrasadas. */
  settledOfferIds: Set<string>;
  /** Rides que ya no admiten ninguna oferta nueva en esta sesión. */
  terminalRideIds: Set<string>;
  /** Token vigente de la última petición de oferta iniciada por ride. */
  offerAttemptTokens: Map<string, number>;
  offerAttemptSequence: number;
  applyPoolEvent: (event: DriverPoolEvent) => DriverPoolReduction;
  dismiss: (rideId: string, poolVersion: number) => void;
  beginOfferAttempt: (rideId: string) => number;
  invalidateAllOfferAttempts: () => void;
  markOffered: (
    rideId: string,
    offer: { id: string; price: number; etaMin: number | null; expiresAt: string | null },
    rideFare: number | undefined,
    attemptToken: number,
  ) => boolean;
  /** Reemplaza solo las ofertas vivas con el snapshot autoritativo del backend. */
  reconcileOffered: (
    offers: {
      rideId: string;
      id: string;
      price: number;
      /** Tarifa vigente de la solicitud, distinta del precio contraofertado. */
      rideFare: number;
      etaMin: number | null;
      expiresAt: string | null;
    }[],
  ) => void;
  markRejected: (rideId: string, offerId?: string) => boolean;
  markTaken: (rideId: string, offerId?: string) => boolean;
  markCancelled: (rideId: string, offerId?: string) => boolean;
  markAssigned: (rideId: string) => boolean;
  /** Confirma por identidad el retiro voluntario de una oferta. */
  markWithdrawn: (rideId: string, offerId: string) => boolean;
  /** Expira solo la oferta vigente esperada; devuelve si aplicó el cambio. */
  markExpired: (rideId: string, offerId: string) => boolean;
  /** Retira únicamente las ofertas de los rides incluidos; devuelve cuántas quitó. */
  withdrawOffered: (rideIds: string[]) => number;
  markPaused: (rideId: string, offerId?: string) => boolean;
  getOffer: (rideId: string) => SentOffer | null;
  isDismissed: (rideId: string) => boolean;
  isOffered: (rideId: string) => boolean;
  reset: () => void;
};

export const useDriverRequests = create<DriverRequestsState>((set, get) => ({
  poolProjection: new Map(),
  dismissed: new Map(),
  offered: {},
  rejected: new Set(),
  taken: new Set(),
  expired: new Set(),
  expiredFares: {},
  paused: new Set(),
  settledOfferIds: new Set(),
  terminalRideIds: new Set(),
  offerAttemptTokens: new Map(),
  offerAttemptSequence: 0,
  applyPoolEvent: (event) => {
    let result: DriverPoolReduction | null = null;
    set((s) => {
      const reduction = reduceDriverPoolEvent(s.poolProjection, event);
      result = reduction;

      let dismissed = s.dismissed;
      if (event.phase === 'open') {
        const dismissedVersion = dismissed.get(event.rideId);
        if (dismissedVersion != null && dismissedVersion < event.poolVersion) {
          dismissed = new Map(dismissed);
          dismissed.delete(event.rideId);
        }
      }

      if (!reduction.clearsOutcomes) {
        if (
          reduction.applied &&
          event.phase === 'terminal' &&
          s.paused.has(event.rideId)
        ) {
          const paused = new Set(s.paused);
          paused.delete(event.rideId);
          return {
            poolProjection: reduction.projection,
            dismissed,
            paused,
          };
        }
        if (
          reduction.projection === s.poolProjection &&
          dismissed === s.dismissed
        ) {
          return s;
        }
        return { poolProjection: reduction.projection, dismissed };
      }

      const rejected = new Set(s.rejected);
      rejected.delete(event.rideId);
      const expired = new Set(s.expired);
      expired.delete(event.rideId);
      const expiredFares = { ...s.expiredFares };
      delete expiredFares[event.rideId];
      const paused = new Set(s.paused);
      paused.delete(event.rideId);
      return {
        poolProjection: reduction.projection,
        dismissed,
        rejected,
        expired,
        expiredFares,
        paused,
      };
    });
    if (!result) {
      throw new Error('No se pudo reducir el evento del pool.');
    }
    return result;
  },
  dismiss: (rideId, poolVersion) =>
    set((s) => ({ dismissed: new Map(s.dismissed).set(rideId, poolVersion) })),
  beginOfferAttempt: (rideId) => {
    let token = 0;
    set((s) => {
      const advanced = advanceOfferAttempt(
        s.offerAttemptSequence,
        s.offerAttemptTokens,
        rideId,
      );
      token = advanced.offerAttemptSequence;
      return advanced;
    });
    return token;
  },
  invalidateAllOfferAttempts: () =>
    set((s) => {
      let offerAttemptSequence = s.offerAttemptSequence;
      let offerAttemptTokens = s.offerAttemptTokens;
      for (const rideId of [...offerAttemptTokens.keys()]) {
        const advanced = advanceOfferAttempt(
          offerAttemptSequence,
          offerAttemptTokens,
          rideId,
        );
        offerAttemptSequence = advanced.offerAttemptSequence;
        offerAttemptTokens = advanced.offerAttemptTokens;
      }
      return { offerAttemptSequence, offerAttemptTokens };
    }),
  markOffered: (rideId, offer, rideFare, attemptToken) => {
    let applied = false;
    set((s) => {
      if (
        s.offerAttemptTokens.get(rideId) !== attemptToken ||
        s.settledOfferIds.has(offer.id) ||
        s.terminalRideIds.has(rideId) ||
        s.paused.has(rideId)
      ) {
        return s;
      }

      applied = true;
      // Volver a ofertar limpia cualquier desenlace previo de esa solicitud.
      const rejected = new Set(s.rejected);
      rejected.delete(rideId);
      const taken = new Set(s.taken);
      taken.delete(rideId);
      const expired = new Set(s.expired);
      expired.delete(rideId);
      const expiredFares = { ...s.expiredFares };
      delete expiredFares[rideId];
      const paused = new Set(s.paused);
      paused.delete(rideId);
      return {
        offered: {
          ...s.offered,
          [rideId]: {
            offerId: offer.id,
            price: offer.price,
            rideFare: rideFare ?? offer.price,
            etaMin: offer.etaMin,
            // Sin fecha del backend, asumimos la ventana de oferta (30 s) desde ahora.
            expiresAt: offer.expiresAt ?? new Date(Date.now() + FALLBACK_TTL_MS).toISOString(),
          },
        },
        rejected,
        taken,
        expired,
        expiredFares,
        paused,
        ...advanceOfferAttempt(
          s.offerAttemptSequence,
          s.offerAttemptTokens,
          rideId,
        ),
      };
    });
    return applied;
  },
  reconcileOffered: (snapshot) =>
    set((s) => {
      const offered: Record<string, SentOffer> = {};
      const liveRideIds = new Set<string>();
      const settledOfferIds = new Set(s.settledOfferIds);
      const terminalRideIds = new Set(s.terminalRideIds);
      let offerAttemptSequence = s.offerAttemptSequence;
      let offerAttemptTokens = s.offerAttemptTokens;
      const now = Date.now();
      for (const offer of snapshot) {
        const reportedExpiresAt =
          offer.expiresAt ?? new Date(now + FALLBACK_TTL_MS).toISOString();
        const expiresAt =
          new Date(reportedExpiresAt).getTime() > now
            ? reportedExpiresAt
            : new Date(now + FALLBACK_TTL_MS).toISOString();
        liveRideIds.add(offer.rideId);
        // PostgreSQL confirma que sigue PENDING: corrige expiraciones locales
        // por reloj adelantado o cualquier guard contradictorio del cliente.
        settledOfferIds.delete(offer.id);
        terminalRideIds.delete(offer.rideId);
        const advanced = advanceOfferAttempt(
          offerAttemptSequence,
          offerAttemptTokens,
          offer.rideId,
        );
        offerAttemptSequence = advanced.offerAttemptSequence;
        offerAttemptTokens = advanced.offerAttemptTokens;
        offered[offer.rideId] = {
          offerId: offer.id,
          price: offer.price,
          rideFare: offer.rideFare,
          etaMin: offer.etaMin,
          expiresAt,
        };
      }

      // El snapshot PENDING limpia desenlaces visuales viejos del mismo ride.
      const rejected = new Set(s.rejected);
      const taken = new Set(s.taken);
      const expired = new Set(s.expired);
      const expiredFares = { ...s.expiredFares };
      const paused = new Set(s.paused);
      for (const rideId of liveRideIds) {
        rejected.delete(rideId);
        taken.delete(rideId);
        expired.delete(rideId);
        delete expiredFares[rideId];
        paused.delete(rideId);
      }
      return {
        offered,
        rejected,
        taken,
        expired,
        expiredFares,
        paused,
        settledOfferIds,
        terminalRideIds,
        offerAttemptSequence,
        offerAttemptTokens,
      };
    }),
  // Cada desenlace limpia la entrada de `offered` (sin zombies) y crea sets nuevos
  // para que los selectores re-rendericen.
  markRejected: (rideId, offerId) => {
    let applied = false;
    set((s) => {
      if (offerId && s.settledOfferIds.has(offerId)) return s;
      const settledOfferIds = offerId
        ? addBounded(s.settledOfferIds, offerId, MAX_SETTLED_OFFERS)
        : s.settledOfferIds;
      const current = s.offered[rideId];
      if (offerId && current && current.offerId !== offerId) {
        return { settledOfferIds };
      }

      applied = true;
      const offered = { ...s.offered };
      delete offered[rideId];
      return {
        offered,
        rejected: new Set(s.rejected).add(rideId),
        settledOfferIds,
        ...advanceOfferAttempt(
          s.offerAttemptSequence,
          s.offerAttemptTokens,
          rideId,
        ),
      };
    });
    return applied;
  },
  markTaken: (rideId, offerId) => {
    let applied = false;
    set((s) => {
      if (s.terminalRideIds.has(rideId)) return s;
      applied = true;
      const offered = { ...s.offered };
      delete offered[rideId];
      return {
        offered,
        taken: new Set(s.taken).add(rideId),
        settledOfferIds: offerId
          ? addBounded(s.settledOfferIds, offerId, MAX_SETTLED_OFFERS)
          : s.settledOfferIds,
        terminalRideIds: addBounded(
          s.terminalRideIds,
          rideId,
          MAX_TERMINAL_RIDES,
        ),
        ...advanceOfferAttempt(
          s.offerAttemptSequence,
          s.offerAttemptTokens,
          rideId,
        ),
      };
    });
    return applied;
  },
  markCancelled: (rideId, offerId) => {
    let applied = false;
    set((s) => {
      if (s.terminalRideIds.has(rideId)) return s;
      applied = true;
      const offered = { ...s.offered };
      delete offered[rideId];
      return {
        offered,
        rejected: new Set(s.rejected).add(rideId),
        settledOfferIds: offerId
          ? addBounded(s.settledOfferIds, offerId, MAX_SETTLED_OFFERS)
          : s.settledOfferIds,
        terminalRideIds: addBounded(
          s.terminalRideIds,
          rideId,
          MAX_TERMINAL_RIDES,
        ),
        ...advanceOfferAttempt(
          s.offerAttemptSequence,
          s.offerAttemptTokens,
          rideId,
        ),
      };
    });
    return applied;
  },
  markAssigned: (rideId) => {
    let applied = false;
    set((s) => {
      if (s.terminalRideIds.has(rideId)) return s;
      applied = true;
      const offered = { ...s.offered };
      delete offered[rideId];
      const rejected = new Set(s.rejected);
      rejected.delete(rideId);
      const taken = new Set(s.taken);
      taken.delete(rideId);
      const expired = new Set(s.expired);
      expired.delete(rideId);
      const expiredFares = { ...s.expiredFares };
      delete expiredFares[rideId];
      const paused = new Set(s.paused);
      paused.delete(rideId);
      return {
        offered,
        rejected,
        taken,
        expired,
        expiredFares,
        paused,
        terminalRideIds: addBounded(
          s.terminalRideIds,
          rideId,
          MAX_TERMINAL_RIDES,
        ),
        ...advanceOfferAttempt(
          s.offerAttemptSequence,
          s.offerAttemptTokens,
          rideId,
        ),
      };
    });
    return applied;
  },
  markWithdrawn: (rideId, offerId) => {
    let applied = false;
    set((s) => {
      if (s.settledOfferIds.has(offerId)) return s;
      const settledOfferIds = addBounded(
        s.settledOfferIds,
        offerId,
        MAX_SETTLED_OFFERS,
      );
      const current = s.offered[rideId];
      if (current && current.offerId !== offerId) return { settledOfferIds };

      applied = true;
      const advanced = advanceOfferAttempt(
        s.offerAttemptSequence,
        s.offerAttemptTokens,
        rideId,
      );
      if (!current) return { settledOfferIds, ...advanced };
      const offered = { ...s.offered };
      delete offered[rideId];
      return { offered, settledOfferIds, ...advanced };
    });
    return applied;
  },
  markExpired: (rideId, offerId) => {
    let applied = false;
    set((s) => {
      if (s.settledOfferIds.has(offerId)) return s;
      const current = s.offered[rideId];
      const settledOfferIds = addBounded(
        s.settledOfferIds,
        offerId,
        MAX_SETTLED_OFFERS,
      );
      if (current && current.offerId !== offerId) return { settledOfferIds };

      applied = true;
      const offered = { ...s.offered };
      delete offered[rideId];
      const expiredFares = { ...s.expiredFares };
      if (current) expiredFares[rideId] = current.rideFare;
      return {
        offered,
        expired: new Set(s.expired).add(rideId),
        expiredFares,
        settledOfferIds,
        ...advanceOfferAttempt(
          s.offerAttemptSequence,
          s.offerAttemptTokens,
          rideId,
        ),
      };
    });
    return applied;
  },
  withdrawOffered: (rideIds) => {
    let withdrawn = 0;
    set((s) => {
      let offered = s.offered;
      let offerAttemptSequence = s.offerAttemptSequence;
      let offerAttemptTokens = s.offerAttemptTokens;
      for (const rideId of new Set(rideIds)) {
        const advanced = advanceOfferAttempt(
          offerAttemptSequence,
          offerAttemptTokens,
          rideId,
        );
        offerAttemptSequence = advanced.offerAttemptSequence;
        offerAttemptTokens = advanced.offerAttemptTokens;
        if (offered[rideId]) {
          if (offered === s.offered) offered = { ...s.offered };
          delete offered[rideId];
          withdrawn += 1;
        }
      }
      if (rideIds.length === 0) return s;
      return { offered, offerAttemptSequence, offerAttemptTokens };
    });
    return withdrawn;
  },
  markPaused: (rideId, offerId) => {
    let applied = false;
    set((s) => {
      if (offerId && s.settledOfferIds.has(offerId)) return s;
      const settledOfferIds = offerId
        ? addBounded(s.settledOfferIds, offerId, MAX_SETTLED_OFFERS)
        : s.settledOfferIds;
      const current = s.offered[rideId];
      if (offerId && current && current.offerId !== offerId) {
        return { settledOfferIds };
      }

      applied = true;
      const offered = { ...s.offered };
      delete offered[rideId];
      return {
        offered,
        paused: new Set(s.paused).add(rideId),
        settledOfferIds,
        ...advanceOfferAttempt(
          s.offerAttemptSequence,
          s.offerAttemptTokens,
          rideId,
        ),
      };
    });
    return applied;
  },
  getOffer: (rideId) => get().offered[rideId] ?? null,
  isDismissed: (rideId) => get().dismissed.has(rideId),
  // Hay oferta "en pie" si existe, no expiró (30 s) y no tuvo desenlace terminal.
  isOffered: (rideId) => {
    const offer = get().offered[rideId];
    return (
      offer != null &&
      Date.now() < new Date(offer.expiresAt).getTime() &&
      !get().rejected.has(rideId) &&
      !get().taken.has(rideId) &&
      !get().expired.has(rideId) &&
      !get().paused.has(rideId)
    );
  },
  reset: () =>
    set({
      poolProjection: new Map(),
      dismissed: new Map(),
      offered: {},
      rejected: new Set(),
      taken: new Set(),
      expired: new Set(),
      expiredFares: {},
      paused: new Set(),
      settledOfferIds: new Set(),
      terminalRideIds: new Set(),
      offerAttemptTokens: new Map(),
      offerAttemptSequence: 0,
    }),
}));

/**
 * Autocuración: pasa a `expired` cualquier oferta cuyo TTL (30 s) ya venció.
 *
 * El estado `expired` normalmente lo puebla el WS `offer_expired`, pero si el
 * conductor cambió de cuenta o se cayó la conexión durante la ventana de la
 * oferta, el evento se pierde y la tarjeta quedaba pegada en "Expirando…".
 * Este hook hace tick cada segundo (y al montar) y marca lo vencido. Cuelga de
 * la pantalla principal del conductor (lista + mapa comparten el mismo estado).
 */
export function useAutoExpireOffers(): void {
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const state = useDriverRequests.getState();
      for (const [rideId, offer] of Object.entries(state.offered)) {
        if (
          new Date(offer.expiresAt).getTime() <= now &&
          !state.expired.has(rideId)
        ) {
          state.markExpired(rideId, offer.offerId);
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
}
