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
 * - `rejected`: el pasajero rechazó la oferta (`declined`) o canceló el viaje
 *   (`ride_cancelled`) — el conductor puede volver a ofertar.
 * - `taken`: otro conductor se llevó el viaje.
 * - `expired`: la oferta venció (30 s) sin respuesta.
 * - `paused`: el pasajero está modificando la solicitud (no se puede ofertar).
 *
 * Al marcar un desenlace se limpia `offered[rideId]` (sin zombies). Se comparte
 * entre la lista, el mapa y la pantalla de estado.
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

type DriverRequestsState = {
  /** Versión descartada de cada solicitud; evita revivirla por un WS repetido. */
  dismissed: Map<string, number>;
  offered: Record<string, SentOffer>;
  /** Oferta rechazada por el pasajero, o viaje cancelado (puede reofertar). */
  rejected: Set<string>;
  /** Viaje que otro conductor se llevó. */
  taken: Set<string>;
  /** Oferta que venció (30 s) sin respuesta del pasajero. */
  expired: Set<string>;
  /** Tarifa vigente al expirar cada oferta; persiste el contexto para reconexión. */
  expiredFares: Record<string, number>;
  /** Solicitud pausada por el pasajero (modificándola). */
  paused: Set<string>;
  dismiss: (rideId: string, poolVersion: number) => void;
  markOffered: (
    rideId: string,
    offer: { id: string; price: number; etaMin: number | null; expiresAt: string | null },
    rideFare?: number,
  ) => void;
  /** Reemplaza solo las ofertas vivas con el snapshot autoritativo del backend. */
  reconcileOffered: (
    offers: {
      rideId: string;
      id: string;
      price: number;
      etaMin: number | null;
      expiresAt: string | null;
    }[],
  ) => void;
  markRejected: (rideId: string) => void;
  markTaken: (rideId: string) => void;
  markExpired: (rideId: string) => void;
  markPaused: (rideId: string) => void;
  /** Saca una solicitud del set `paused` sin tocar el resto (al volver al pool). */
  clearPaused: (rideId: string) => void;
  /** Saca el descarte solo si el pasajero publicó una versión más nueva. */
  clearDismissedBefore: (rideId: string, poolVersion: number) => void;
  /** Saca una solicitud del set `expired` (la oferta previa caducó; el ride se renovó). */
  clearExpired: (rideId: string) => void;
  /** Saca una solicitud del set `rejected` (la oferta previa fue rechazada; el ride se renovó). */
  clearRejected: (rideId: string) => void;
  /** Limpia todo rastro de una solicitud (al ganarla o salir del pool). */
  clearRide: (rideId: string) => void;
  getOffer: (rideId: string) => SentOffer | null;
  isDismissed: (rideId: string) => boolean;
  isOffered: (rideId: string) => boolean;
  reset: () => void;
};

export const useDriverRequests = create<DriverRequestsState>((set, get) => ({
  dismissed: new Map(),
  offered: {},
  rejected: new Set(),
  taken: new Set(),
  expired: new Set(),
  expiredFares: {},
  paused: new Set(),
  dismiss: (rideId, poolVersion) =>
    set((s) => ({ dismissed: new Map(s.dismissed).set(rideId, poolVersion) })),
  markOffered: (rideId, offer, rideFare = offer.price) =>
    set((s) => {
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
            rideFare,
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
      };
    }),
  reconcileOffered: (snapshot) =>
    set((s) => {
      const offered: Record<string, SentOffer> = {};
      const liveRideIds = new Set<string>();
      const now = Date.now();
      for (const offer of snapshot) {
        const expiresAt =
          offer.expiresAt ?? new Date(now + FALLBACK_TTL_MS).toISOString();
        if (new Date(expiresAt).getTime() <= now) continue;
        liveRideIds.add(offer.rideId);
        offered[offer.rideId] = {
          offerId: offer.id,
          price: offer.price,
          rideFare: offer.price,
          etaMin: offer.etaMin,
          expiresAt,
        };
      }

      // Un estado local terminal contradice una oferta que el servidor confirma
      // como PENDING. `dismissed` se preserva: es una preferencia local distinta.
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
      return { offered, rejected, taken, expired, expiredFares, paused };
    }),
  // Cada desenlace limpia la entrada de `offered` (sin zombies) y crea sets nuevos
  // para que los selectores re-rendericen.
  markRejected: (rideId) =>
    set((s) => {
      const offered = { ...s.offered };
      delete offered[rideId];
      return { offered, rejected: new Set(s.rejected).add(rideId) };
    }),
  markTaken: (rideId) =>
    set((s) => {
      const offered = { ...s.offered };
      delete offered[rideId];
      return { offered, taken: new Set(s.taken).add(rideId) };
    }),
  markExpired: (rideId) =>
    set((s) => {
      const offered = { ...s.offered };
      const rideFare = offered[rideId]?.rideFare;
      delete offered[rideId];
      const expiredFares = { ...s.expiredFares };
      if (rideFare != null) expiredFares[rideId] = rideFare;
      return { offered, expired: new Set(s.expired).add(rideId), expiredFares };
    }),
  markPaused: (rideId) =>
    set((s) => {
      const offered = { ...s.offered };
      delete offered[rideId];
      return { offered, paused: new Set(s.paused).add(rideId) };
    }),
  clearPaused: (rideId) =>
    set((s) => {
      if (!s.paused.has(rideId)) return s;
      const paused = new Set(s.paused);
      paused.delete(rideId);
      return { paused };
    }),
  clearDismissedBefore: (rideId, poolVersion) =>
    set((s) => {
      const dismissedVersion = s.dismissed.get(rideId);
      if (dismissedVersion == null || dismissedVersion >= poolVersion) return s;
      const dismissed = new Map(s.dismissed);
      dismissed.delete(rideId);
      return { dismissed };
    }),
  clearExpired: (rideId) =>
    set((s) => {
      if (!s.expired.has(rideId) && s.expiredFares[rideId] == null) return s;
      const expired = new Set(s.expired);
      expired.delete(rideId);
      const expiredFares = { ...s.expiredFares };
      delete expiredFares[rideId];
      return { expired, expiredFares };
    }),
  clearRejected: (rideId) =>
    set((s) => {
      if (!s.rejected.has(rideId)) return s;
      const rejected = new Set(s.rejected);
      rejected.delete(rideId);
      return { rejected };
    }),
  clearRide: (rideId) =>
    set((s) => {
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
      const dismissed = new Map(s.dismissed);
      dismissed.delete(rideId);
      return { offered, rejected, taken, expired, expiredFares, paused, dismissed };
    }),
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
      dismissed: new Map(),
      offered: {},
      rejected: new Set(),
      taken: new Set(),
      expired: new Set(),
      expiredFares: {},
      paused: new Set(),
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
          state.markExpired(rideId);
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
}
