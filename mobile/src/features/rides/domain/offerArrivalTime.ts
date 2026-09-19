/** Round provider travel time up without presenting a zero-minute arrival. */
export function arrivalMinutesFromSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes <= 240 ? minutes : null;
}
