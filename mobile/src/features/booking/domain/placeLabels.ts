/** Etiquetas de ubicaciones, priorizando la calle para orientar al usuario. */
import type { Place } from '@/features/booking/domain/types';

const STREET_PREFIX = /^(?:av(?:enida)?\.?|calle|c\.?|pasaje|pje\.?|ruta|carretera|anillo)\b/i;

/**
 * Devuelve la referencia más útil para llegar a un punto: calle y número cuando
 * están disponibles; de lo contrario, conserva el nombre del lugar.
 */
export function getPlaceStreetName({
  name,
  address,
}: Pick<Place, 'name'> & Partial<Pick<Place, 'address'>>): string {
  const shortName = name.trim();
  const addressFirstLine = address?.split(',')[0]?.trim() ?? '';

  if (STREET_PREFIX.test(shortName)) return shortName;
  if (STREET_PREFIX.test(addressFirstLine)) return addressFirstLine;
  return shortName || addressFirstLine || 'Ubicación seleccionada';
}
