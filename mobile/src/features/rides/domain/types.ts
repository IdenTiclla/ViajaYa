/**
 * Tipos del dominio del flujo de viaje con ofertas (pasajero ↔ conductor).
 * Reutiliza `Place`, `ServiceType` y `PaymentMethod` del feature `booking`.
 */
import type { PaymentMethod, Place, ServiceType } from '@/features/booking/domain/types';

export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'arriving'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/**
 * Estado de una oferta: `pending` (esperando al pasajero) → `accepted` (el
 * pasajero la aceptó y se le asignó el viaje). Las demás ofertas del viaje
 * quedan `rejected`; `expired` si venció su ventana de 30 s sin ser aceptada.
 */
export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

/** Datos públicos del conductor que hace una oferta. */
export type OfferDriver = {
  id: string;
  fullName: string;
  rating: number | null;
  vehicleType: ServiceType | null;
  plate: string | null;
  vehicleModel: string | null;
};

/** Oferta recibida por el pasajero (o emitida por el conductor). */
export type Offer = {
  id: string;
  rideId: string;
  price: number;
  etaMin: number | null;
  status: OfferStatus;
  driver: OfferDriver;
  createdAt: string | null;
  /**
   * Instante ISO en que vence la oferta; alimenta el contador
   * (`created_at + 30 s`).
   */
  expiresAt: string | null;
};

/** Datos públicos del pasajero que el conductor ve en una solicitud abierta. */
export type OpenRideRider = {
  id: string;
  fullName: string;
  rating: number | null;
  tripsCompleted: number;
};

/** Solicitud abierta tal como la ve un conductor en su lista. */
export type OpenRide = {
  id: string;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
  origin: Place;
  destination: Place;
  rider: OpenRideRider;
  createdAt: string | null;
};

/** Conductor asignado, visible para el pasajero durante el viaje. */
export type RideDriver = {
  id: string;
  fullName: string;
  phone: string | null;
  rating: number | null;
  vehicleType: ServiceType | null;
  plate: string | null;
  vehicleModel: string | null;
};

/** Datos del pasajero asignado, visibles para el conductor durante el viaje. */
export type RideRider = {
  id: string;
  fullName: string;
  phone: string | null;
  rating: number | null;
};

/** Detalle completo de un viaje (polling de estado para ambos lados). */
export type Ride = {
  id: string;
  riderId: string;
  rider: RideRider;
  status: RideStatus;
  /** La solicitud sigue buscando, pero esta oculta mientras el pasajero la edita. */
  paused: boolean;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
  origin: Place;
  destination: Place;
  driver: RideDriver | null;
  acceptedPrice: number | null;
  acceptedEtaMin: number | null;
};

/** Calificación que una parte deja a la otra al terminar el viaje. */
export type RatingInput = {
  score: number;
  comment?: string | null;
};

/** La otra parte del viaje en una tarjeta de historial. */
export type HistoryCounterpart = {
  id: string;
  fullName: string;
  rating: number | null;
  vehicleType: ServiceType | null;
  vehicleModel: string | null;
  plate: string | null;
};

/** Un viaje del historial (completado o cancelado). */
export type RideHistoryItem = {
  id: string;
  status: RideStatus;
  service: ServiceType;
  payment: PaymentMethod;
  origin: Place;
  destination: Place;
  price: number;
  myRating: number | null;
  counterpart: HistoryCounterpart | null;
  createdAt: string | null;
};

/** Una línea del desglose de ganancias del conductor. */
export type EarningsItem = {
  rideId: string;
  destinationName: string;
  price: number;
  completedAt: string | null;
};

/** Resumen de ganancias del conductor. */
export type DriverEarnings = {
  totalToday: number;
  tripsToday: number;
  totalAllTime: number;
  tripsAllTime: number;
  recent: EarningsItem[];
};

/** Oferta del conductor: aceptar al precio del pasajero o contraofertar. */
export type CreateOfferInput = {
  acceptAtFare: boolean;
  price?: number;
  etaMin?: number;
};

/** Cambios para modificar una solicitud pausada (Modificar solicitud). */
export type EditRideInput = {
  origin: Place;
  destination: Place;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
};
