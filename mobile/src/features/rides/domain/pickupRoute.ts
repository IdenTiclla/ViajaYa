/**
 * Pickup leg (driver → pickup point) of an assigned ride. Pure helpers with no
 * IO or framework so both maps agree on when and how that route is drawn.
 */
import type { Coordinates } from '@/core/domain/geo';

/** Statuses where the driver is still heading to (or waiting at) the pickup point. */
export function isPickupPhase(status: string): boolean {
  return status === 'accepted' || status === 'arriving';
}

/**
 * Grid size (degrees, ~220 m) used to decide when the pickup route is requested
 * again. GPS reports every second; keying the route by cell instead of by raw
 * position keeps provider calls to one per ~220 m travelled, and both screens
 * of the same device share the cached route.
 */
export const PICKUP_ROUTE_CELL_DEG = 0.002;

/** Below this straight-line distance (m) the driver is at the pickup point: no route. */
export const PICKUP_ARRIVED_METERS = 60;

export function pickupRouteCell({ latitude, longitude }: Coordinates): [number, number] {
  return [Math.round(latitude / PICKUP_ROUTE_CELL_DEG), Math.round(longitude / PICKUP_ROUTE_CELL_DEG)];
}

/** Equirectangular distance in meters: accurate enough at city scale. */
export function approxDistanceMeters(a: Coordinates, b: Coordinates): number {
  const meanLat = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const x = (b.longitude - a.longitude) * Math.cos(meanLat);
  const y = b.latitude - a.latitude;
  return Math.sqrt(x * x + y * y) * 111_320;
}

/**
 * Starts a cached route at the vehicle's current position: drops the part the
 * driver already covered (up to the closest vertex) and joins the vehicle to
 * the remainder, so the line never trails behind the marker between refreshes.
 */
export function trimRouteToVehicle(route: readonly Coordinates[], vehicle: Coordinates): Coordinates[] {
  if (route.length < 2) return [...route];
  let closest = 0;
  let best = Infinity;
  for (let index = 0; index < route.length; index += 1) {
    const distance = approxDistanceMeters(route[index], vehicle);
    if (distance < best) {
      best = distance;
      closest = index;
    }
  }
  const remainder = route.slice(Math.min(closest + 1, route.length - 1));
  return [vehicle, ...remainder];
}

/** True when every point lies within `meters` of the first one (a camera fit would over-zoom). */
export function isTightCluster(points: readonly Coordinates[], meters: number): boolean {
  return points.every((point) => approxDistanceMeters(points[0], point) <= meters);
}

/**
 * Two opposite corners of a square of `halfSideMeters` around `center`: fitting
 * them frames a point at street level while still honoring the map's edge padding
 * (a plain camera center would sit behind the bottom sheet).
 */
export function streetLevelFrame(center: Coordinates, halfSideMeters: number): [Coordinates, Coordinates] {
  const dLat = halfSideMeters / 111_320;
  const dLon = dLat / Math.max(0.01, Math.cos(center.latitude * (Math.PI / 180)));
  return [
    { latitude: center.latitude - dLat, longitude: center.longitude - dLon },
    { latitude: center.latitude + dLat, longitude: center.longitude + dLon },
  ];
}
