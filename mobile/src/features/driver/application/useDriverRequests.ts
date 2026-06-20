/**
 * Estado local del conductor sobre las solicitudes abiertas (zustand).
 *
 * El backend no tiene "rechazo" de solicitud por parte del conductor: descartar
 * es un gesto del cliente para ocultar de su lista las que no le interesan.
 *
 * `offered` recuerda la oferta que el conductor envió a cada solicitud (id,
 * precio, ETA e instante de expiración, 30 s) **mientras siga viva**. Al vencer,
 * la solicitud vuelve a ser ofertable. `rejected` marca las solicitudes cuya
 * oferta el pasajero rechazó (aviso en vivo por WebSocket): el conductor puede
 * volver a ofertar o **mejorar** su propuesta. `taken` marca solicitudes que
 * otro conductor se llevó. Se comparte entre la lista, el mapa, el detalle y la
 * pantalla de estado.
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
  /** rideId cuya oferta del conductor fue rechazada por el pasajero (en vivo). */
  rejected: Set<string>;
  /** rideId que otro conductor se llevó (viaje perdido). */
  taken: Set<string>;
  dismiss: (rideId: string) => void;
  markOffered: (
    rideId: string,
    offer: { id: string; price: number; etaMin: number | null; expiresAt: string | null },
  ) => void;
  markRejected: (rideId: string) => void;
  markTaken: (rideId: string) => void;
  /** Limpia todo rastro de una solicitud (p. ej. al ganar/abandonarla). */
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
  dismiss: (rideId) => set((s) => ({ dismissed: new Set(s.dismissed).add(rideId) })),
  markOffered: (rideId, offer) =>
    set((s) => {
      // Volver a ofertar limpia el rechazo/pérdida previa de esa solicitud.
      const rejected = new Set(s.rejected);
      rejected.delete(rideId);
      const taken = new Set(s.taken);
      taken.delete(rideId);
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
      };
    }),
  // Crea estructuras nuevas para que los selectores re-rendericen.
  markRejected: (rideId) => set((s) => ({ rejected: new Set(s.rejected).add(rideId) })),
  markTaken: (rideId) => set((s) => ({ taken: new Set(s.taken).add(rideId) })),
  clearRide: (rideId) =>
    set((s) => {
      const offered = { ...s.offered };
      delete offered[rideId];
      const rejected = new Set(s.rejected);
      rejected.delete(rideId);
      const taken = new Set(s.taken);
      taken.delete(rideId);
      return { offered, rejected, taken };
    }),
  getOffer: (rideId) => get().offered[rideId] ?? null,
  isDismissed: (rideId) => get().dismissed.has(rideId),
  // Hay oferta "en pie" si existe, no expiró (30 s) y no fue rechazada (en ese
  // caso el conductor debe poder re-ofertar, así que ya no cuenta como ofertada).
  isOffered: (rideId) => {
    const offer = get().offered[rideId];
    return (
      offer != null &&
      Date.now() < new Date(offer.expiresAt).getTime() &&
      !get().rejected.has(rideId)
    );
  },
}));
