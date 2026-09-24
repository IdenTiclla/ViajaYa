import type { Coordinates } from '@/core/domain/geo';

export type MovementSample = {
  coordinates: Coordinates;
  heading: number | null;
  speed: number | null;
  precision: number | null;
  timestamp: number;
};

export function validHeading(heading: number | null): heading is number {
  return heading != null && Number.isFinite(heading) && heading >= 0 && heading < 360;
}

/** At low speed the GPS heading may be zero or keep an old value. */
export function movementHeading(previous: MovementSample | null, current: MovementSample): number | null {
  if (current.speed != null && current.speed >= 1 && validHeading(current.heading)) {
    return current.heading;
  }
  if (!previous || (current.speed != null && current.speed >= 0 && current.speed < 0.5)) return null;
  const time = current.timestamp - previous.timestamp;
  if (time <= 0 || time > 15000) return null;
  const degToRad = Math.PI / 180;
  const lat1 = previous.coordinates.latitude * degToRad;
  const lat2 = current.coordinates.latitude * degToRad;
  const deltaLongitude = (current.coordinates.longitude - previous.coordinates.longitude) * degToRad;
  const haversineTerm = Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(haversineTerm)));
  // Require a displacement larger than the uncertainty so noise does not set the orientation.
  const margin = Math.max(4, previous.precision ?? 8, current.precision ?? 8);
  if (distance < margin) return null;
  const y = Math.sin(deltaLongitude) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude);
  return (Math.atan2(y, x) / degToRad + 360) % 360;
}

export function compassHeading(reading: { trueHeading: number; magHeading: number; accuracy: number }): number | null {
  if (reading.accuracy < 2) return null;
  if (validHeading(reading.trueHeading)) return reading.trueHeading;
  return validHeading(reading.magHeading) ? reading.magHeading : null;
}
