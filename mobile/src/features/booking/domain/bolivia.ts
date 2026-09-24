import type { Coordinates, Place } from '@/features/booking/domain/types';

import boliviaBoundary from './data/bolivia_admin0_ne10m.json';

export const BOLIVIA_COUNTRY_CODE = 'BO';
export const BOLIVIA_SERVICE_AREA_MESSAGE =
  'ViajaYa opera actualmente solo dentro de Bolivia.';

// The rectangle bounds the camera and avoids walking the outline for distant points.
export const BOLIVIA_NORTH_EAST: Coordinates = {
  latitude: -9.65,
  longitude: -57.4,
};

export const BOLIVIA_SOUTH_WEST: Coordinates = {
  latitude: -22.9,
  longitude: -69.7,
};

export const BOLIVIA_DEFAULT_COORDINATES: Coordinates = {
  latitude: -16.5,
  longitude: -68.15,
};

type OutlinePoint = readonly [longitud: number, latitud: number];

// Byte-for-byte copy of the backend's authoritative resource. The JSON keeps the
// source, reproducible commit and Natural Earth's public-domain license.
const BOLIVIA_OUTLINE =
  boliviaBoundary.geometry.coordinates[0] as unknown as readonly OutlinePoint[];
const OUTLINE_EPSILON = 1e-10;

function pointIsOnSegment(
  point: OutlinePoint,
  start: OutlinePoint,
  end: OutlinePoint,
): boolean {
  const [px, py] = point;
  const [ax, ay] = start;
  const [bx, by] = end;
  const crossProduct = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  const scale = Math.max(1, Math.abs(bx - ax), Math.abs(by - ay));
  if (Math.abs(crossProduct) > OUTLINE_EPSILON * scale) return false;
  return (
    px >= Math.min(ax, bx) - OUTLINE_EPSILON &&
    px <= Math.max(ax, bx) + OUTLINE_EPSILON &&
    py >= Math.min(ay, by) - OUTLINE_EPSILON &&
    py <= Math.max(ay, by) + OUTLINE_EPSILON
  );
}

/** Ray casting with the boundary included, equivalent to the backend validation. */
function outlineCovers(point: OutlinePoint): boolean {
  let isInside = false;
  let previous = BOLIVIA_OUTLINE[BOLIVIA_OUTLINE.length - 1];

  for (const current of BOLIVIA_OUTLINE) {
    if (pointIsOnSegment(point, previous, current)) return true;

    const [px, py] = point;
    const [ax, ay] = previous;
    const [bx, by] = current;
    if ((ay > py) !== (by > py)) {
      const crossingX = ax + ((py - ay) * (bx - ax)) / (by - ay);
      if (crossingX > px) isInside = !isInside;
    }
    previous = current;
  }

  return isInside;
}

export function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length === 2 ? normalized : null;
}

export function isCoordinatesInBolivia(coordinates: Coordinates): boolean {
  const insideBounds =
    coordinates.latitude >= BOLIVIA_SOUTH_WEST.latitude &&
    coordinates.latitude <= BOLIVIA_NORTH_EAST.latitude &&
    coordinates.longitude >= BOLIVIA_SOUTH_WEST.longitude &&
    coordinates.longitude <= BOLIVIA_NORTH_EAST.longitude;
  if (!insideBounds) return false;
  return outlineCovers([coordinates.longitude, coordinates.latitude]);
}

export function isPlaceInBolivia(place: Place): boolean {
  return getBoliviaPlaceError(place) == null;
}

export function getBoliviaPlaceError(place: Place): string | null {
  const countryCode = normalizeCountryCode(place.countryCode);
  if (!isCoordinatesInBolivia(place.coordinates)) return BOLIVIA_SERVICE_AREA_MESSAGE;
  // The geocoder only improves the label and may be unavailable. As in
  // the backend, the local outline is the authority and the country code is a hint.
  if (place.countryCode != null && countryCode == null) return BOLIVIA_SERVICE_AREA_MESSAGE;
  if (countryCode != null && countryCode !== BOLIVIA_COUNTRY_CODE) {
    return BOLIVIA_SERVICE_AREA_MESSAGE;
  }
  return null;
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
