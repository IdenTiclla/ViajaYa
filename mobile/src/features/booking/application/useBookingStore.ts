/**
 * Booking flow state (zustand), shared across the screens:
 * Home (origin) → Destination search → Pick on map → Configure trip.
 *
 * Follows the same pattern as `authStore`: a single global store with setters.
 */
import { create } from 'zustand';

import type { PaymentMethod, Place, ServiceType } from '@/features/booking/domain/types';

type BookingState = {
  /** Origin; set by the Home map when the camera moves. */
  origin: Place | null;
  /** Destination; set by the recents list or the map picker. */
  destination: Place | null;
  /** Service chosen for the request. */
  service: ServiceType;
  /** Payment method chosen for the request. */
  payment: PaymentMethod;
  /** The user's fare (editable text; validated when searching for offers). */
  fare: string;
  setOrigin: (origin: Place) => void;
  setDestination: (destination: Place) => void;
  setService: (service: ServiceType) => void;
  setPayment: (payment: PaymentMethod) => void;
  setFare: (fare: string) => void;
  /** Clear the destination/fare when starting a new search (keeps the origin). */
  resetTrip: () => void;
  /** Limpia todo dato sensible al cambiar de cuenta. */
  resetAll: () => void;
};

export const useBookingStore = create<BookingState>((set) => ({
  origin: null,
  destination: null,
  service: 'taxi',
  payment: 'cash',
  fare: '',
  setOrigin: (origin) => set({ origin }),
  setDestination: (destination) => set({ destination }),
  setService: (service) => set({ service }),
  setPayment: (payment) => set({ payment }),
  setFare: (fare) => set({ fare }),
  resetTrip: () => set({ destination: null, fare: '' }),
  resetAll: () =>
    set({ origin: null, destination: null, service: 'taxi', payment: 'cash', fare: '' }),
}));
