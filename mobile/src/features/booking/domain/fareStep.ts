/** Smallest fare the +/− buttons can reach (the backend requires a fare above zero). */
export const MIN_STEPPED_FARE = 1;

/**
 * Next value of the typed fare after pressing + or −: moves by whole bolivianos
 * from the current amount (a comma counts as the decimal separator) and never
 * goes below {@link MIN_STEPPED_FARE}. An empty or invalid amount starts from zero.
 */
export function stepFare(fare: string, delta: number): string {
  const current = Number(fare.replace(',', '.'));
  const base = Number.isFinite(current) && current > 0 ? current : 0;
  const next = Math.max(MIN_STEPPED_FARE, Math.round((base + delta) * 100) / 100);
  return String(next);
}
