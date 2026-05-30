/**
 * Acceso HTTP a la API de viajes (usa el cliente axios único con Bearer/refresh).
 * Mapea el contrato del backend (`/rides`) a/desde los tipos del dominio móvil.
 */
import { api } from '@/core/http/client';
import type { PaymentMethod, Place, ServiceType } from '@/features/booking/domain/types';

type PointDto = { latitude: number; longitude: number; name: string; address: string };

type RideRequestDto = {
  id: string;
  status: string;
  service_type: ServiceType;
  payment_method: PaymentMethod;
  fare: string;
  origin: PointDto;
  destination: PointDto;
  created_at: string | null;
};

export type RideRequest = {
  id: string;
  status: string;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
  origin: Place;
  destination: Place;
};

function toPointDto(place: Place): PointDto {
  return {
    latitude: place.coordinates.latitude,
    longitude: place.coordinates.longitude,
    name: place.name,
    address: place.address,
  };
}

function toPlace(dto: PointDto): Place {
  return {
    coordinates: { latitude: dto.latitude, longitude: dto.longitude },
    name: dto.name,
    address: dto.address,
  };
}

export type CreateRideInput = {
  origin: Place;
  destination: Place;
  service: ServiceType;
  payment: PaymentMethod;
  fare: number;
};

export const ridesRepository = {
  async create(input: CreateRideInput): Promise<RideRequest> {
    const { data } = await api.post<RideRequestDto>('/rides', {
      origin: toPointDto(input.origin),
      destination: toPointDto(input.destination),
      service_type: input.service,
      payment_method: input.payment,
      fare: input.fare,
    });
    return {
      id: data.id,
      status: data.status,
      service: data.service_type,
      payment: data.payment_method,
      fare: Number.parseFloat(data.fare),
      origin: toPlace(data.origin),
      destination: toPlace(data.destination),
    };
  },

  async recentDestinations(): Promise<Place[]> {
    const { data } = await api.get<PointDto[]>('/rides/recent-destinations');
    return data.map(toPlace);
  },
};
