import type { Coordinates, Place } from '@/features/booking/domain/types';

import boliviaBoundary from './data/bolivia_admin0_ne10m.json';

export const BOLIVIA_COUNTRY_CODE = 'BO';
export const BOLIVIA_SERVICE_AREA_MESSAGE =
  'ViajaYa opera actualmente solo dentro de Bolivia.';

// El rectángulo limita la cámara y evita recorrer el contorno para puntos lejanos.
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

type PuntoContorno = readonly [longitud: number, latitud: number];

// Copia byte a byte del recurso autoritativo del backend. El JSON conserva la
// fuente, commit reproducible y licencia de dominio público de Natural Earth.
const CONTORNO_BOLIVIA =
  boliviaBoundary.geometry.coordinates[0] as unknown as readonly PuntoContorno[];
const EPSILON_CONTORNO = 1e-10;

function puntoEstaEnSegmento(
  punto: PuntoContorno,
  inicio: PuntoContorno,
  fin: PuntoContorno,
): boolean {
  const [px, py] = punto;
  const [ax, ay] = inicio;
  const [bx, by] = fin;
  const productoCruzado = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  const escala = Math.max(1, Math.abs(bx - ax), Math.abs(by - ay));
  if (Math.abs(productoCruzado) > EPSILON_CONTORNO * escala) return false;
  return (
    px >= Math.min(ax, bx) - EPSILON_CONTORNO &&
    px <= Math.max(ax, bx) + EPSILON_CONTORNO &&
    py >= Math.min(ay, by) - EPSILON_CONTORNO &&
    py <= Math.max(ay, by) + EPSILON_CONTORNO
  );
}

/** Ray casting con el borde incluido, equivalente a la validación del backend. */
function contornoCubre(punto: PuntoContorno): boolean {
  let estaDentro = false;
  let anterior = CONTORNO_BOLIVIA[CONTORNO_BOLIVIA.length - 1];

  for (const actual of CONTORNO_BOLIVIA) {
    if (puntoEstaEnSegmento(punto, anterior, actual)) return true;

    const [px, py] = punto;
    const [ax, ay] = anterior;
    const [bx, by] = actual;
    if ((ay > py) !== (by > py)) {
      const cruceX = ax + ((py - ay) * (bx - ax)) / (by - ay);
      if (cruceX > px) estaDentro = !estaDentro;
    }
    anterior = actual;
  }

  return estaDentro;
}

export function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length === 2 ? normalized : null;
}

export function isCoordinatesInBolivia(coordinates: Coordinates): boolean {
  const dentroDelRectangulo =
    coordinates.latitude >= BOLIVIA_SOUTH_WEST.latitude &&
    coordinates.latitude <= BOLIVIA_NORTH_EAST.latitude &&
    coordinates.longitude >= BOLIVIA_SOUTH_WEST.longitude &&
    coordinates.longitude <= BOLIVIA_NORTH_EAST.longitude;
  if (!dentroDelRectangulo) return false;
  return contornoCubre([coordinates.longitude, coordinates.latitude]);
}

export function isPlaceInBolivia(place: Place): boolean {
  return getBoliviaPlaceError(place) == null;
}

export function getBoliviaPlaceError(place: Place): string | null {
  const countryCode = normalizeCountryCode(place.countryCode);
  if (!isCoordinatesInBolivia(place.coordinates)) return BOLIVIA_SERVICE_AREA_MESSAGE;
  // El geocoder solo mejora la etiqueta y puede no estar disponible. Como en
  // el backend, el contorno local es la autoridad y el código de país una pista.
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
