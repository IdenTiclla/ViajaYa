/** Utilidades geográficas del dominio (sin IO ni framework). */
import type { Coordinates } from '@/features/booking/domain/types';

/** Distancia en línea recta (haversine) entre dos puntos, en kilómetros. */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371; // radio terrestre (km)
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Formatea una distancia (km) para mostrar: "850 m" o "12.4 km". */
export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** Precio por kilómetro (Bs/km) formateado, o ``null`` si la distancia es ~0. */
export function pricePerKm(fare: number, km: number): string | null {
  if (km < 0.1) return null;
  return (fare / km).toFixed(2);
}
