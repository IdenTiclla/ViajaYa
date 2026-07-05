/**
 * Cola de notificaciones efímeras (toasts) del pasajero: avisa del desenlace de
 * las ofertas que recibe (nueva, expirada, retirada) aunque no esté mirando la
 * lista. Lo empuja el socket del pasajero (`useNegotiationSocket`); el
 * `PassengerToaster` los muestra y auto-descarta.
 *
 * Modelo análogo a `useDriverToasts` (mismo store zustand, máx 3, ids únicos).
 */
import { create } from 'zustand';

export type PassengerToastKind = 'offer_received' | 'offer_expired' | 'offer_withdrawn';

export type PassengerToast = {
  id: string;
  kind: PassengerToastKind;
  rideId: string;
  title: string;
  message: string;
};

type PassengerToastsState = {
  toasts: PassengerToast[];
  push: (toast: Omit<PassengerToast, 'id'>) => void;
  dismiss: (id: string) => void;
};

let _seq = 0;

export const usePassengerToasts = create<PassengerToastsState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((s) => ({
      // Máximo 3 en pantalla (las más recientes).
      toasts: [...s.toasts, { ...toast, id: `${Date.now()}-${_seq++}` }].slice(-3),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
