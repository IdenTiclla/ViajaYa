import { create } from 'zustand';
import type { Coordinates } from '@/core/domain/geo';

type SharingState = {
  rideId: string | null;
  coordinates: Coordinates | null;
  heading: number | null;
  status: 'off' | 'starting' | 'sharing' | 'error';
  error: string | null;
};
export const useLocationSharingStore = create<SharingState>(() => ({ rideId: null, coordinates: null, heading: null, status: 'off', error: null }));
