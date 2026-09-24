/**
 * Domain types of the ride flow with offers (passenger ↔ driver).
 * Reuses `Place`, `ServiceType` and `PaymentMethod` from the `booking` feature.
 */
import type { PaymentMethod, Place, ServiceType } from '@/features/booking/domain/types';
import type { VehicleType } from '@/features/auth/domain/types';

export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'arriving'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/**
 * Status of an offer: `pending` (waiting for the passenger) → `accepted` (the
 * passenger accepted it and was assigned the ride). The ride's other offers
 * become `rejected`; `expired` if its 30 s window ran out without being accepted.
 */
export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

/** Public data of the driver making an offer. */
export type OfferDriver = {
  id: string;
  fullName: string;
  rating: number | null;
  vehicleType: VehicleType | null;
  plate: string | null;
  vehicleModel: string | null;
};

/** Offer received by the passenger (or sent by the driver). */
export type Offer = {
  id: string;
  rideId: string;
  price: number;
  etaMin: number | null;
  status: OfferStatus;
  driver: OfferDriver;
  createdAt: string | null;
  /**
   * ISO instant when the offer expires; drives the countdown
   * (`created_at + 30 s`).
   */
  expiresAt: string | null;
};

/** Public passenger data the driver sees on an open request. */
export type OpenRideRider = {
  id: string;
  fullName: string;
  rating: number | null;
  tripsCompleted: number;
};

/** Open request as a driver sees it in their list. */
export type OpenRide = {
  id: string;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
  origin: Place;
  destination: Place;
  rider: OpenRideRider;
  /** Changes when the request's visible terms are modified. */
  poolVersion: number;
  createdAt: string | null;
};

/** Assigned driver, visible to the passenger during the ride. */
export type RideDriver = {
  id: string;
  fullName: string;
  phone: string | null;
  rating: number | null;
  vehicleType: VehicleType | null;
  plate: string | null;
  vehicleModel: string | null;
};

/** The assigned passenger's data, visible to the driver during the ride. */
export type RideRider = {
  id: string;
  fullName: string;
  phone: string | null;
  rating: number | null;
};

/** Full ride detail (status polling for both sides). */
export type Ride = {
  id: string;
  riderId: string;
  rider: RideRider;
  status: RideStatus;
  /** The request is still searching, but hidden while the passenger edits it. */
  paused: boolean;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
  origin: Place;
  destination: Place;
  driver: RideDriver | null;
  acceptedPrice: number | null;
  acceptedEtaMin: number | null;
  /** Passenger pickup acknowledgement, preserved across reconnects. */
  riderOnTheWayAt: string | null;
};

/** Rating one party leaves for the other when the ride ends. */
export type RatingInput = {
  score: number;
  comment?: string | null;
};

/** The other party of the ride on a history card. */
export type HistoryCounterpart = {
  id: string;
  fullName: string;
  rating: number | null;
  vehicleType: VehicleType | null;
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

/** One line of the driver's earnings breakdown. */
export type EarningsItem = {
  rideId: string;
  destinationName: string;
  price: number;
  completedAt: string | null;
};

/** The driver's earnings summary. */
export type DriverEarnings = {
  totalToday: number;
  tripsToday: number;
  totalAllTime: number;
  tripsAllTime: number;
  recent: EarningsItem[];
};

/** The driver's offer: accept at the passenger's price or counter-offer. */
export type CreateOfferInput = {
  acceptAtFare: boolean;
  expectedPoolVersion?: number;
  price?: number;
  etaMin?: number;
};

/** Changes to modify a paused request (Modify request). */
export type EditRideInput = {
  origin: Place;
  destination: Place;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
};
