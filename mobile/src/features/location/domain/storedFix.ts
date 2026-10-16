/** Serialization of the last accepted fix (kept so a cold start opens on a useful map). */
import type { Coordinates } from '@/core/domain/geo';

export const STORED_FIX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A fix is stored at most this often. */
export const STORED_FIX_SAVE_INTERVAL_MS = 30_000;
/** Fixes less precise than this are not worth remembering. */
export const STORED_FIX_MAX_ACCURACY_METERS = 200;

export type StoredFix = { coordinates: Coordinates; savedAt: number };

export function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) return false;
  const { latitude, longitude } = value as Record<string, unknown>;
  return (
    typeof latitude === 'number' && typeof longitude === 'number'
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  );
}

export function serializeFix(coordinates: Coordinates, now: number): string {
  return JSON.stringify({ latitude: coordinates.latitude, longitude: coordinates.longitude, savedAt: now });
}

/** Returns the stored fix, or `null` when it is missing, malformed, from the future or too old. */
export function parseStoredFix(
  raw: string | null,
  now: number,
  maxAgeMs: number = STORED_FIX_MAX_AGE_MS,
): StoredFix | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidCoordinates(value)) return null;
  const savedAt = (value as unknown as Record<string, unknown>).savedAt;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
  if (savedAt > now + 60_000 || now - savedAt > maxAgeMs) return null;
  return { coordinates: { latitude: value.latitude, longitude: value.longitude }, savedAt };
}
