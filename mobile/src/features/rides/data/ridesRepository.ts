/**
 * Acceso HTTP al flujo de ofertas y ciclo de vida del viaje.
 *
 * Usa el cliente axios único (`@/core/http/client`, con Bearer/refresh) y mapea
 * el contrato del backend (`/rides`, `/drivers`) a/desde los tipos del dominio.
 * La *creación* de la solicitud sigue viviendo en `booking/data/ridesRepository`.
 */
import { api } from '@/core/http/client';
import type { Place } from '@/features/booking/domain/types';
import type {
  CreateOfferInput,
  DriverEarnings,
  EditRideInput,
  Offer,
  OpenRide,
  RatingInput,
  Ride,
  RideHistoryItem,
  RideStatus,
} from '@/features/rides/domain/types';

type PointDto = { latitude: number; longitude: number; name: string; address: string };

function toPlace(dto: PointDto): Place {
  return {
    coordinates: { latitude: dto.latitude, longitude: dto.longitude },
    name: dto.name,
    address: dto.address,
  };
}

function toPointDto(place: Place): PointDto {
  return {
    latitude: place.coordinates.latitude,
    longitude: place.coordinates.longitude,
    name: place.name,
    address: place.address,
  };
}

type OfferDriverDto = {
  id: string;
  full_name: string;
  rating: number | null;
  vehicle_type: Offer['driver']['vehicleType'];
  plate: string | null;
  vehicle_model: string | null;
};

export type OfferDto = {
  id: string;
  ride_id: string;
  price: string;
  eta_min: number | null;
  status: Offer['status'];
  driver: OfferDriverDto;
  created_at: string | null;
  expires_at: string | null;
};

export function toOffer(dto: OfferDto): Offer {
  return {
    id: dto.id,
    rideId: dto.ride_id,
    price: Number.parseFloat(dto.price),
    etaMin: dto.eta_min,
    status: dto.status,
    driver: {
      id: dto.driver.id,
      fullName: dto.driver.full_name,
      rating: dto.driver.rating,
      vehicleType: dto.driver.vehicle_type,
      plate: dto.driver.plate,
      vehicleModel: dto.driver.vehicle_model,
    },
    createdAt: dto.created_at,
    expiresAt: dto.expires_at,
  };
}

type OpenRideRiderDto = {
  id: string;
  full_name: string;
  rating: number | null;
  trips_completed: number;
};

export type OpenRideDto = {
  id: string;
  service_type: OpenRide['service'];
  fare: string;
  payment_method: OpenRide['payment'];
  origin: PointDto;
  destination: PointDto;
  rider: OpenRideRiderDto;
  created_at: string | null;
};

export function toOpenRide(dto: OpenRideDto): OpenRide {
  return {
    id: dto.id,
    service: dto.service_type,
    payment: dto.payment_method,
    fare: Number.parseFloat(dto.fare),
    origin: toPlace(dto.origin),
    destination: toPlace(dto.destination),
    rider: {
      id: dto.rider.id,
      fullName: dto.rider.full_name,
      rating: dto.rider.rating,
      tripsCompleted: dto.rider.trips_completed,
    },
    createdAt: dto.created_at,
  };
}

type RideDriverDto = {
  id: string;
  full_name: string;
  phone: string | null;
  rating: number | null;
  vehicle_type: Ride['service'] | null;
  plate: string | null;
  vehicle_model: string | null;
};

export type RideDto = {
  id: string;
  rider_id: string;
  status: RideStatus;
  service_type: Ride['service'];
  fare: string;
  payment_method: Ride['payment'];
  origin: PointDto;
  destination: PointDto;
  driver: RideDriverDto | null;
  accepted_price: string | null;
  accepted_eta_min: number | null;
};

export function toRide(dto: RideDto): Ride {
  return {
    id: dto.id,
    riderId: dto.rider_id,
    status: dto.status,
    service: dto.service_type,
    fare: Number.parseFloat(dto.fare),
    payment: dto.payment_method,
    origin: toPlace(dto.origin),
    destination: toPlace(dto.destination),
    driver: dto.driver
      ? {
          id: dto.driver.id,
          fullName: dto.driver.full_name,
          phone: dto.driver.phone,
          rating: dto.driver.rating,
          vehicleType: dto.driver.vehicle_type,
          plate: dto.driver.plate,
          vehicleModel: dto.driver.vehicle_model,
        }
      : null,
    acceptedPrice: dto.accepted_price ? Number.parseFloat(dto.accepted_price) : null,
    acceptedEtaMin: dto.accepted_eta_min,
  };
}

type HistoryCounterpartDto = {
  id: string;
  full_name: string;
  rating: number | null;
  vehicle_type: RideHistoryItem['service'] | null;
  vehicle_model: string | null;
  plate: string | null;
};

type RideHistoryItemDto = {
  id: string;
  status: RideStatus;
  service_type: RideHistoryItem['service'];
  payment_method: RideHistoryItem['payment'];
  origin: PointDto;
  destination: PointDto;
  price: string;
  my_rating: number | null;
  counterpart: HistoryCounterpartDto | null;
  created_at: string | null;
};

function toHistoryItem(dto: RideHistoryItemDto): RideHistoryItem {
  return {
    id: dto.id,
    status: dto.status,
    service: dto.service_type,
    payment: dto.payment_method,
    origin: toPlace(dto.origin),
    destination: toPlace(dto.destination),
    price: Number.parseFloat(dto.price),
    myRating: dto.my_rating,
    counterpart: dto.counterpart
      ? {
          id: dto.counterpart.id,
          fullName: dto.counterpart.full_name,
          rating: dto.counterpart.rating,
          vehicleType: dto.counterpart.vehicle_type,
          vehicleModel: dto.counterpart.vehicle_model,
          plate: dto.counterpart.plate,
        }
      : null,
    createdAt: dto.created_at,
  };
}

type EarningsItemDto = {
  ride_id: string;
  destination_name: string;
  price: string;
  completed_at: string | null;
};

type DriverEarningsDto = {
  total_today: string;
  trips_today: number;
  total_all_time: string;
  trips_all_time: number;
  recent: EarningsItemDto[];
};

function toEarnings(dto: DriverEarningsDto): DriverEarnings {
  return {
    totalToday: Number.parseFloat(dto.total_today),
    tripsToday: dto.trips_today,
    totalAllTime: Number.parseFloat(dto.total_all_time),
    tripsAllTime: dto.trips_all_time,
    recent: dto.recent.map((item) => ({
      rideId: item.ride_id,
      destinationName: item.destination_name,
      price: Number.parseFloat(item.price),
      completedAt: item.completed_at,
    })),
  };
}

export const ridesRepository = {
  // --- Conductor ---
  async getOpenRides(): Promise<OpenRide[]> {
    const { data } = await api.get<OpenRideDto[]>('/rides/open');
    return data.map(toOpenRide);
  },

  async getEarnings(): Promise<DriverEarnings> {
    const { data } = await api.get<DriverEarningsDto>('/drivers/me/earnings');
    return toEarnings(data);
  },

  async createOffer(rideId: string, input: CreateOfferInput): Promise<Offer> {
    const { data } = await api.post<OfferDto>(`/rides/${rideId}/offers`, {
      accept_at_fare: input.acceptAtFare,
      price: input.price,
      eta_min: input.etaMin,
    });
    return toOffer(data);
  },

  async updateStatus(rideId: string, status: RideStatus): Promise<Ride> {
    const { data } = await api.patch<RideDto>(`/rides/${rideId}/status`, { status });
    return toRide(data);
  },

  async setOnline(isOnline: boolean): Promise<boolean> {
    const { data } = await api.post<{ is_online: boolean }>('/drivers/me/online', {
      is_online: isOnline,
    });
    return data.is_online;
  },

  async getActiveRide(): Promise<Ride | null> {
    const { data } = await api.get<RideDto | null>('/drivers/me/active-ride');
    return data ? toRide(data) : null;
  },

  /** Conductor: retira su oferta (o se niega a confirmar una aceptada). */
  async withdrawOffer(offerId: string): Promise<void> {
    await api.post(`/rides/offers/${offerId}/withdraw`);
  },

  // --- Pasajero ---
  async listOffers(rideId: string): Promise<Offer[]> {
    const { data } = await api.get<OfferDto[]>(`/rides/${rideId}/offers`);
    return data.map(toOffer);
  },

  /**
   * Pasajero: acepta una oferta y le asigna el viaje (decisión final). El
   * backend devuelve el viaje ya asignado; las demás ofertas del viaje quedan
   * rechazadas en la misma transacción.
   */
  async acceptOffer(offerId: string): Promise<Ride> {
    const { data } = await api.post<RideDto>(`/rides/offers/${offerId}/accept`);
    return toRide(data);
  },

  /** Pasajero: rechaza una oferta concreta (el conductor lo ve en vivo). */
  async rejectOffer(offerId: string): Promise<void> {
    await api.post(`/rides/offers/${offerId}/reject`);
  },

  // --- Ambos ---
  async getRide(rideId: string): Promise<Ride> {
    const { data } = await api.get<RideDto>(`/rides/${rideId}`);
    return toRide(data);
  },

  async getHistory(status?: RideStatus): Promise<RideHistoryItem[]> {
    const { data } = await api.get<RideHistoryItemDto[]>('/rides/history', {
      params: status ? { status } : undefined,
    });
    return data.map(toHistoryItem);
  },

  async rateRide(rideId: string, input: RatingInput): Promise<void> {
    await api.post(`/rides/${rideId}/rating`, {
      score: input.score,
      comment: input.comment,
    });
  },

  async cancel(rideId: string): Promise<Ride> {
    const { data } = await api.post<RideDto>(`/rides/${rideId}/cancel`);
    return toRide(data);
  },

  /** Pasajero: aumenta su oferta mientras se buscan conductores. */
  async updateFare(rideId: string, fare: number): Promise<Ride> {
    const { data } = await api.patch<RideDto>(`/rides/${rideId}/fare`, { fare });
    return toRide(data);
  },

  /** Pasajero: pausa la solicitud para editarla (Modificar): la oculta del pool. */
  async pauseForEdit(rideId: string): Promise<Ride> {
    const { data } = await api.post<RideDto>(`/rides/${rideId}/pause-edit`);
    return toRide(data);
  },

  /** Pasajero: guarda los cambios de una solicitud pausada y la vuelve a publicar. */
  async editRide(rideId: string, input: EditRideInput): Promise<Ride> {
    const { data } = await api.patch<RideDto>(`/rides/${rideId}`, {
      origin: toPointDto(input.origin),
      destination: toPointDto(input.destination),
      service_type: input.service,
      fare: input.fare,
      payment_method: input.payment,
    });
    return toRide(data);
  },
};
