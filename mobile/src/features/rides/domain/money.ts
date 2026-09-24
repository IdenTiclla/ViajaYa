/** Format amounts in bolivianos without visual noise for whole amounts. */
export function formatBolivianos(value: number): string {
  const normalized = Math.round(value * 100) / 100;
  if (Number.isInteger(normalized)) return String(normalized);
  return normalized.toFixed(2);
}

/** Initial value for inputs: favors whole numbers, but does not alter real decimals. */
export function formatBolivianosInput(value: number): string {
  const normalized = Math.round(value * 100) / 100;
  return String(normalized);
}
