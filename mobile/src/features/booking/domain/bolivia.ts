import type { Coordinates, Place } from '@/features/booking/domain/types';

export const BOLIVIA_COUNTRY_CODE = 'BO';
export const BOLIVIA_SERVICE_AREA_MESSAGE =
  'ViajaYa opera actualmente solo dentro de Bolivia.';
export const BOLIVIA_UNCONFIRMED_AREA_MESSAGE =
  'No pudimos confirmar que esta ubicación esté en Bolivia. Revisa tu conexión y mueve el mapa nuevamente.';

// El rectángulo limita la cámara; countryCode cierra los falsos positivos fronterizos.
export const BOLIVIA_NORTH_EAST: Coordinates = {
  latitude: -9.65,
  longitude: -57.4,
};

export const BOLIVIA_SOUTH_WEST: Coordinates = {
  latitude: -22.9,
  longitude: -69.65,
};

export const BOLIVIA_DEFAULT_COORDINATES: Coordinates = {
  latitude: -16.5,
  longitude: -68.15,
};

export function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length === 2 ? normalized : null;
}

export function isCoordinatesInBolivia(coordinates: Coordinates): boolean {
  return (
    coordinates.latitude >= BOLIVIA_SOUTH_WEST.latitude &&
    coordinates.latitude <= BOLIVIA_NORTH_EAST.latitude &&
    coordinates.longitude >= BOLIVIA_SOUTH_WEST.longitude &&
    coordinates.longitude <= BOLIVIA_NORTH_EAST.longitude
  );
}

export function isPlaceInBolivia(place: Place): boolean {
  return getBoliviaPlaceError(place) == null;
}

export function getBoliviaPlaceError(place: Place): string | null {
  const countryCode = normalizeCountryCode(place.countryCode);
  if (!isCoordinatesInBolivia(place.coordinates)) return BOLIVIA_SERVICE_AREA_MESSAGE;
  if (countryCode == null) return BOLIVIA_UNCONFIRMED_AREA_MESSAGE;
  return countryCode === BOLIVIA_COUNTRY_CODE ? null : BOLIVIA_SERVICE_AREA_MESSAGE;
}

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
