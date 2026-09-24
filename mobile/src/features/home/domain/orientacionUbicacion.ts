import type { Coordinates } from '@/core/domain/geo';

export type MuestraMovimiento = {
  coordinates: Coordinates;
  rumbo: number | null;
  velocidad: number | null;
  precision: number | null;
  timestamp: number;
};

export function rumboValido(rumbo: number | null): rumbo is number {
  return rumbo != null && Number.isFinite(rumbo) && rumbo >= 0 && rumbo < 360;
}

/** At low speed the GPS heading may be zero or keep an old value. */
export function rumboDelMovimiento(anterior: MuestraMovimiento | null, actual: MuestraMovimiento): number | null {
  if (actual.velocidad != null && actual.velocidad >= 1 && rumboValido(actual.rumbo)) {
    return actual.rumbo;
  }
  if (!anterior || (actual.velocidad != null && actual.velocidad >= 0 && actual.velocidad < 0.5)) return null;
  const tiempo = actual.timestamp - anterior.timestamp;
  if (tiempo <= 0 || tiempo > 15000) return null;
  const radianes = Math.PI / 180;
  const lat1 = anterior.coordinates.latitude * radianes;
  const lat2 = actual.coordinates.latitude * radianes;
  const longitud = (actual.coordinates.longitude - anterior.coordinates.longitude) * radianes;
  const haverseno = Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(longitud / 2) ** 2;
  const distancia = 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(haverseno)));
  // Require a displacement larger than the uncertainty so noise does not set the orientation.
  const margen = Math.max(4, anterior.precision ?? 8, actual.precision ?? 8);
  if (distancia < margen) return null;
  const y = Math.sin(longitud) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(longitud);
  return (Math.atan2(y, x) / radianes + 360) % 360;
}

export function rumboDeBrujula(lectura: { trueHeading: number; magHeading: number; accuracy: number }): number | null {
  if (lectura.accuracy < 2) return null;
  if (rumboValido(lectura.trueHeading)) return lectura.trueHeading;
  return rumboValido(lectura.magHeading) ? lectura.magHeading : null;
}
