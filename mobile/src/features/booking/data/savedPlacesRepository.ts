/**
 * Acceso HTTP a la API de lugares guardados (`/saved-places`).
 * Usa el cliente axios único (Bearer/refresh) y mapea el contrato del backend
 * a/desde los tipos del dominio móvil, igual que `ridesRepository`.
 */
import { api } from '@/core/http/client';
import { getPlaceStreetName } from '@/features/booking/domain/placeLabels';
import type { Place, SavedPlace, SavedPlaceCategory } from '@/features/booking/domain/types';

type PointDto = {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  country_code?: string | null;
};

type SavedPlaceDto = {
  id: string;
  label: string;
  category: SavedPlaceCategory;
  location: PointDto;
};

function toPointDto(place: Place): PointDto {
  return {
    latitude: place.coordinates.latitude,
    longitude: place.coordinates.longitude,
    name: place.name,
    address: place.address,
    country_code: place.countryCode,
  };
}

function toSavedPlace(dto: SavedPlaceDto): SavedPlace {
  return {
    id: dto.id,
    label: dto.label,
    category: dto.category,
    place: {
      coordinates: { latitude: dto.location.latitude, longitude: dto.location.longitude },
      name: getPlaceStreetName(dto.location),
      address: dto.location.address,
      countryCode: dto.location.country_code?.toUpperCase() ?? null,
    },
  };
}

export type SavePlaceInput = {
  label: string;
  category: SavedPlaceCategory;
  place: Place;
};

function toBody(input: SavePlaceInput) {
  return { label: input.label, category: input.category, location: toPointDto(input.place) };
}

export const savedPlacesRepository = {
  async list(): Promise<SavedPlace[]> {
    const { data } = await api.get<SavedPlaceDto[]>('/saved-places');
    return data.map(toSavedPlace);
  },

  async create(input: SavePlaceInput): Promise<SavedPlace> {
    const { data } = await api.post<SavedPlaceDto>('/saved-places', toBody(input));
    return toSavedPlace(data);
  },

  async update(id: string, input: SavePlaceInput): Promise<SavedPlace> {
    const { data } = await api.put<SavedPlaceDto>(`/saved-places/${id}`, toBody(input));
    return toSavedPlace(data);
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/saved-places/${id}`);
  },
};
