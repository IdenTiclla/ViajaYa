/**
 * Cola de notificaciones efímeras (toasts) del conductor: avisa del desenlace de
 * sus ofertas (expiró, rechazaron, tomada, cancelada, pausada, aceptada) aunque
 * no esté mirando la tarjeta. Lo empuja el socket del conductor; el
 * `DriverToaster` los muestra y auto-descarta.
 */
import { create } from 'zustand';

export type DriverToastKind =
  | 'expired'
  | 'rejected'
  | 'taken'
  | 'cancelled'
  | 'paused'
  | 'accepted'
  | 'connection_error';

export type DriverToast = {
  id: string;
  kind: DriverToastKind;
  rideId: string;
  title: string;
  message: string;
};

type DriverToastsState = {
  toasts: DriverToast[];
  push: (toast: Omit<DriverToast, 'id'>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

let _seq = 0;

export const useDriverToasts = create<DriverToastsState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((s) => ({
      // Máximo 3 en pantalla (las más recientes).
      toasts: [...s.toasts, { ...toast, id: `${Date.now()}-${_seq++}` }].slice(-3),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
