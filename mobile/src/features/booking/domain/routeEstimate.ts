/**
 * Pure helpers for the route estimate shown on the trip configuration map:
 * where to anchor it (halfway along the road, not along the straight line) and
 * how to write distance, duration and arrival time in Spanish.
 */
import type { Coordinates } from '@/core/domain/geo';
import { haversineKm } from '@/features/rides/domain/geo';

/** Point halfway along the polyline by travelled distance; `null` without a route. */
export function routeMidpoint(route: readonly Coordinates[]): Coordinates | null {
  if (route.length === 0) return null;
  if (route.length === 1) return route[0];
  const legs: number[] = [];
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    const leg = haversineKm(route[i - 1], route[i]);
    legs.push(leg);
    total += leg;
  }
  if (total <= 0) return route[0];
  let remaining = total / 2;
  for (let i = 0; i < legs.length; i += 1) {
    if (remaining <= legs[i]) {
      const t = legs[i] === 0 ? 0 : remaining / legs[i];
      const from = route[i];
      const to = route[i + 1];
      return {
        latitude: from.latitude + (to.latitude - from.latitude) * t,
        longitude: from.longitude + (to.longitude - from.longitude) * t,
      };
    }
    remaining -= legs[i];
  }
  return route[route.length - 1];
}

/** "850 m" below one kilometre, otherwise "4,2 km" (decimal comma). */
export function formatRouteDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(0, Math.round(meters))} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** "12 min"; from one hour on, "1 h 05 min". Never less than one minute. */
export function formatRouteDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
}

/** Local 24-hour clock time ("14:32") of leaving `now` and driving `seconds`. */
export function formatArrivalTime(now: Date, seconds: number): string {
  const arrival = new Date(now.getTime() + Math.max(0, seconds) * 1000);
  const hours = String(arrival.getHours()).padStart(2, '0');
  const minutes = String(arrival.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
