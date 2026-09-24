/**
 * Queue of the driver's ephemeral notifications (toasts): reports the outcome of
 * their offers (expired, rejected, taken, cancelled, paused, accepted) even when
 * they are not looking at the card. Fed by the driver socket;
 * `DriverToaster` shows them and auto-dismisses them.
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
      // At most 3 on screen (the most recent).
      toasts: [...s.toasts, { ...toast, id: `${Date.now()}-${_seq++}` }].slice(-3),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
