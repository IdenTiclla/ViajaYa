/**
 * Estado local del conductor sobre las solicitudes abiertas (zustand).
 *
 * El backend no tiene "rechazo" de solicitud por parte del conductor: descartar
 * es un gesto del cliente para ocultar de su lista las que no le interesan.
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
import { create } from 'zustand';

/** Datos de la oferta que el conductor envió a una solicitud. */
export type SentOffer = {
  offerId: string;
  price: number;
  etaMin: number | null;
  expiresAt: string;
};

const FALLBACK_TTL_MS = 30_000;

type DriverRequestsState = {
  dismissed: Set<string>;
  offered: Record<string, SentOffer>;
  /** Oferta rechazada por el pasajero, o viaje cancelado (puede reofertar). */
  rejected: Set<string>;
  /** Viaje que otro conductor se llevó. */
  taken: Set<string>;
  /** Oferta que venció (30 s) sin respuesta del pasajero. */
  expired: Set<string>;
  /** Solicitud pausada por el pasajero (modificándola). */
  paused: Set<string>;
  dismiss: (rideId: string) => void;
  markOffered: (
    rideId: string,
    offer: { id: string; price: number; etaMin: number | null; expiresAt: string | null },
  ) => void;
  markRejected: (rideId: string) => void;
  markTaken: (rideId: string) => void;
  markExpired: (rideId: string) => void;
  markPaused: (rideId: string) => void;
  /** Limpia todo rastro de una solicitud (al ganarla o salir del pool). */
  clearRide: (rideId: string) => void;
  getOffer: (rideId: string) => SentOffer | null;
  isDismissed: (rideId: string) => boolean;
  isOffered: (rideId: string) => boolean;
};

export const useDriverRequests = create<DriverRequestsState>((set, get) => ({
  dismissed: new Set(),
  offered: {},
  rejected: new Set(),
  taken: new Set(),
  expired: new Set(),
  paused: new Set(),
  dismiss: (rideId) => set((s) => ({ dismissed: new Set(s.dismissed).add(rideId) })),
  markOffered: (rideId, offer) =>
    set((s) => {
      // Volver a ofertar limpia cualquier desenlace previo de esa solicitud.
      const rejected = new Set(s.rejected);
      rejected.delete(rideId);
      const taken = new Set(s.taken);
      taken.delete(rideId);
      const expired = new Set(s.expired);
      expired.delete(rideId);
      const paused = new Set(s.paused);
      paused.delete(rideId);
      return {
        offered: {
          ...s.offered,
          [rideId]: {
            offerId: offer.id,
            price: offer.price,
            etaMin: offer.etaMin,
            // Sin fecha del backend, asumimos la ventana de oferta (30 s) desde ahora.
            expiresAt: offer.expiresAt ?? new Date(Date.now() + FALLBACK_TTL_MS).toISOString(),
          },
        },
        rejected,
        taken,
        expired,
        paused,
      };
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
      delete offered[rideId];
      return { offered, expired: new Set(s.expired).add(rideId) };
    }),
  markPaused: (rideId) =>
    set((s) => {
      const offered = { ...s.offered };
      delete offered[rideId];
      return { offered, paused: new Set(s.paused).add(rideId) };
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
      const paused = new Set(s.paused);
      paused.delete(rideId);
      const dismissed = new Set(s.dismissed);
      dismissed.delete(rideId);
      return { offered, rejected, taken, expired, paused, dismissed };
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
}));
