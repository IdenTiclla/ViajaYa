/**
 * Queue of the passenger's ephemeral notifications (toasts): reports the outcome of
 * the offers they receive (new, expired, withdrawn) even when they are not looking at the
 * list. Fed by the passenger socket (`useNegotiationSocket`);
 * `PassengerToaster` shows them and auto-dismisses them.
 *
 * Same model as `useDriverToasts` (same zustand store, max 3, unique ids).
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
  clear: () => void;
};

let _seq = 0;

export const usePassengerToasts = create<PassengerToastsState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((s) => ({
      // At most 3 on screen (the most recent).
      toasts: [...s.toasts, { ...toast, id: `${Date.now()}-${_seq++}` }].slice(-3),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
