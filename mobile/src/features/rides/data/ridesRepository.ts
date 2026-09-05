/**
 * Acceso HTTP al flujo de ofertas y ciclo de vida del viaje.
 *
 * Usa el cliente axios único (`@/core/http/client`, con Bearer/refresh) y mapea
 * el contrato del backend (`/rides`, `/drivers`) a/desde los tipos del dominio.
 * La *creación* de la solicitud sigue viviendo en `booking/data/ridesRepository`.
 */
import { api } from '@/core/http/client';
import type { components } from '@/core/http/generated/openapi';
import {
  assertPlaceLabelResolved,
  getPlaceReadableAddress,
  getPlaceStreetName,
} from '@/features/booking/domain/placeLabels';
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

type ApiSchemas = components['schemas'];

type PointDto = ApiSchemas['PointSchema'];
type PointInputDto = ApiSchemas['PointInputSchema'];

function toPlace(dto: PointDto): Place {
  return {
    coordinates: { latitude: dto.latitude, longitude: dto.longitude },
    name: getPlaceStreetName(dto),
    address: dto.address,
    countryCode: dto.country_code?.toUpperCase() ?? null,
  };
}

function toPointDto(place: Place): PointInputDto {
  assertPlaceLabelResolved(place);
  return {
    latitude: place.coordinates.latitude,
    longitude: place.coordinates.longitude,
    name: getPlaceStreetName(place),
    address: getPlaceReadableAddress(place),
    country_code: place.countryCode,
  };
}

export type OfferDto = ApiSchemas['OfferResponse'];

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

export type OpenRideDto = ApiSchemas['OpenRideResponse'];

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
    poolVersion: dto.pool_version,
    createdAt: dto.created_at,
  };
}

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type OpenRidePageDto = ApiSchemas['OpenRidePageResponse'];

export function toOpenRidePage(dto: OpenRidePageDto): CursorPage<OpenRide> {
  return {
    items: dto.items.map(toOpenRide),
    nextCursor: dto.next_cursor,
  };
}

export type RideDto = ApiSchemas['RideResponse'];

export function toRide(dto: RideDto): Ride {
  return {
    id: dto.id,
    riderId: dto.rider_id,
    rider: {
      id: dto.rider.id,
      fullName: dto.rider.full_name,
      phone: dto.rider.phone,
      rating: dto.rider.rating,
    },
    status: dto.status,
    paused: dto.paused,
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

type RideHistoryItemDto = ApiSchemas['RideHistoryItemResponse'];
type RideHistoryPageDto = ApiSchemas['RideHistoryPageResponse'];

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

type DriverEarningsDto = ApiSchemas['DriverEarningsResponse'];

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
  async getOpenRides(
    cursor: string | null = null,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<CursorPage<OpenRide>> {
    const { data } = await api.get<OpenRidePageDto>('/rides/open', {
      signal,
      params: {
        ...(cursor != null ? { cursor } : {}),
        ...(limit != null ? { limit } : {}),
      },
    });
    return toOpenRidePage(data);
  },

  async dismissOpenRide(rideId: string): Promise<void> {
    await api.post(`/rides/${rideId}/dismiss`);
  },

  async getEarnings(signal?: AbortSignal): Promise<DriverEarnings> {
    const { data } = await api.get<DriverEarningsDto>('/drivers/me/earnings', {
      signal,
    });
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

  async getActiveRide(signal?: AbortSignal): Promise<Ride | null> {
    const { data } = await api.get<RideDto | null>('/drivers/me/active-ride', {
      signal,
    });
    return data ? toRide(data) : null;
  },

  /** Conductor: retira su oferta (o se niega a confirmar una aceptada). */
  async withdrawOffer(offerId: string): Promise<void> {
    await api.post(`/rides/offers/${offerId}/withdraw`);
  },

  // --- Pasajero ---
  async getPassengerActiveRide(signal?: AbortSignal): Promise<Ride | null> {
    const { data } = await api.get<RideDto | null>('/rides/me/active', {
      signal,
    });
    return data ? toRide(data) : null;
  },

  /** Ambos roles: ultimo viaje completado que el usuario aun no califico. */
  async getPendingRatingRide(signal?: AbortSignal): Promise<Ride | null> {
    const { data } = await api.get<RideDto | null>('/rides/me/pending-rating', {
      signal,
    });
    return data ? toRide(data) : null;
  },

  async listOffers(rideId: string, signal?: AbortSignal): Promise<Offer[]> {
    const { data } = await api.get<OfferDto[]>(`/rides/${rideId}/offers`, {
      signal,
    });
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
  async getRide(rideId: string, signal?: AbortSignal): Promise<Ride> {
    const { data } = await api.get<RideDto>(`/rides/${rideId}`, { signal });
    return toRide(data);
  },

  async getHistory(
    status?: RideStatus,
    cursor: string | null = null,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<CursorPage<RideHistoryItem>> {
    const { data } = await api.get<RideHistoryPageDto>('/rides/history', {
      signal,
      params: {
        ...(status ? { status } : {}),
        ...(cursor != null ? { cursor } : {}),
        ...(limit != null ? { limit } : {}),
      },
    });
    return {
      items: data.items.map(toHistoryItem),
      nextCursor: data.next_cursor,
    };
  },

  async rateRide(rideId: string, input: RatingInput): Promise<void> {
    await api.post(`/rides/${rideId}/rating`, {
      score: input.score,
      comment: input.comment,
    });
  },

  async skipRating(rideId: string): Promise<void> {
    await api.post(`/rides/${rideId}/rating/skip`);
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
