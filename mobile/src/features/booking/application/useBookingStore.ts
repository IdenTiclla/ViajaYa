/**
 * Estado del flujo de reserva (zustand), compartido entre las pantallas:
 * Home (origen) → Búsqueda de destino → Seleccionar en mapa → Configurar viaje.
 *
 * Sigue el mismo patrón que `authStore`: un único store global con setters.
 */
import { create } from 'zustand';

import type { PaymentMethod, Place, ServiceType } from '@/features/booking/domain/types';

type BookingState = {
  /** Punto de partida; lo fija el mapa del Home al mover la cámara. */
  origin: Place | null;
  /** Destino; lo fija la lista de recientes o el selector en mapa. */
  destination: Place | null;
  /** Servicio elegido para la solicitud. */
  service: ServiceType;
  /** Forma de pago elegida para la solicitud. */
  payment: PaymentMethod;
  /** Oferta del usuario (texto editable; se valida al buscar ofertas). */
  fare: string;
  setOrigin: (origin: Place) => void;
  setDestination: (destination: Place) => void;
  setService: (service: ServiceType) => void;
  setPayment: (payment: PaymentMethod) => void;
  setFare: (fare: string) => void;
  /** Limpia el destino/oferta al iniciar una nueva búsqueda (conserva el origen). */
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
