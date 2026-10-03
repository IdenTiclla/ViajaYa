/**
 * Rides whose "¡Viaje confirmado!" screen the driver already dismissed in this
 * session, so the takeover opens stage 2 once instead of on every remount.
 */
import { create } from 'zustand';

const MAX_REMEMBERED = 20;

type ConfirmedRidesState = {
  seen: string[];
  markSeen: (rideId: string) => void;
};

export const useConfirmedRides = create<ConfirmedRidesState>((set) => ({
  seen: [],
  markSeen: (rideId) => set((state) => state.seen.includes(rideId)
    ? state
    : { seen: [...state.seen, rideId].slice(-MAX_REMEMBERED) }),
}));
