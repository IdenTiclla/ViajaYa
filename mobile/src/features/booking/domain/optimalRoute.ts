import type { Coordinates } from './types';

export type RouteResult = {
  coordinates: Coordinates[];
  distanceMeters: number;
  durationSeconds: number;
};

type ProviderRoute = {
  polyline?: { geoJsonLinestring?: { coordinates?: unknown } };
  distanceMeters?: unknown;
  duration?: unknown;
};

/** Choose the fastest valid alternative; distance breaks equal-duration ties. */
export function selectOptimalRoute(routes: ProviderRoute[]): RouteResult | null {
  const valid: RouteResult[] = [];
  for (const route of routes) {
    const points = route?.polyline?.geoJsonLinestring?.coordinates;
    const duration = typeof route?.duration === 'string' && /^\d+(\.\d+)?s$/.test(route.duration)
      ? Number.parseFloat(route.duration) : NaN;
    // Google omits default numeric fields when both waypoints snap to the
    // same road position. That valid arrival has 0s and a single coordinate.
    const distance = route?.distanceMeters === undefined && duration === 0
      ? 0 : route?.distanceMeters;
    const stationary = duration === 0 && distance === 0;
    if (!Array.isArray(points) || points.length < (stationary ? 1 : 2) || !Number.isFinite(duration)
      || typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) continue;
    if (!points.every((point: unknown) => Array.isArray(point) && point.length >= 2
      && typeof point[0] === 'number' && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180
      && typeof point[1] === 'number' && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90)) continue;
    valid.push({
      coordinates: points.map(([longitude, latitude]: number[]) => ({ latitude, longitude })),
      distanceMeters: distance,
      durationSeconds: duration,
    });
  }
  return valid.sort((a, b) => a.durationSeconds - b.durationSeconds || a.distanceMeters - b.distanceMeters)[0] ?? null;
}
