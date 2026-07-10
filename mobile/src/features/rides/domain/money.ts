/** Formatea importes en bolivianos sin ruido visual para montos enteros. */
export function formatBolivianos(value: number): string {
  const normalized = Math.round(value * 100) / 100;
  if (Number.isInteger(normalized)) return String(normalized);
  return normalized.toFixed(2);
}

/** Valor inicial para inputs: favorece enteros, pero no altera decimales reales. */
export function formatBolivianosInput(value: number): string {
  const normalized = Math.round(value * 100) / 100;
  return String(normalized);
}
