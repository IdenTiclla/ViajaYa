/** Location labels, prioritizing the street to help the user find their way. */
import type { Place } from '@/features/booking/domain/types';

const STREET_PREFIX = /^(?:av(?:enida)?\.?|calle|c\.?|pasaje|pje\.?|ruta|carretera|anillo)\b/i;
const COORDINATES_ONLY = /^-?\d{1,2}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/;
const COORDINATE_VALUE = /^-?\d{1,3}(?:\.\d+)?$/;
const NON_FINAL_NAMES = new Set([
  'ubicación seleccionada',
  'ubicacion seleccionada',
  'dirección seleccionada',
  'direccion seleccionada',
  'dirección pendiente',
  'dirección no disponible',
  'obteniendo dirección…',
  'obteniendo dirección...',
  'origen',
  'destino',
  'lugar',
]);

function isUsefulText(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase('es-BO') ?? '';
  return (
    Boolean(normalized) &&
    !NON_FINAL_NAMES.has(normalized) &&
    !COORDINATES_ONLY.test(normalized) &&
    !COORDINATE_VALUE.test(normalized)
  );
}

/** Keep a provisional or inherited label from reaching the driver. */
export function isPlaceLabelResolved(place: Pick<Place, 'name' | 'address' | 'labelStatus'>): boolean {
  if (place.labelStatus === 'provisional') return false;
  return isUsefulText(place.name) || isUsefulText(place.address);
}

export function assertPlaceLabelResolved(
  place: Pick<Place, 'name' | 'address' | 'labelStatus'>,
): void {
  if (!isPlaceLabelResolved(place)) {
    throw new Error('Aún falta obtener el nombre del origen o destino. Reintenta la ubicación.');
  }
}

/**
 * Return the most useful reference to reach a point: street and number when
 * available; otherwise, keep the place name.
 */
export function getPlaceStreetName({
  name,
  address,
  labelStatus,
}: Pick<Place, 'name'> & Partial<Pick<Place, 'address' | 'labelStatus'>>): string {
  if (labelStatus === 'provisional') return 'Obteniendo dirección…';
  const shortName = name.trim();
  const addressFirstLine = address?.split(',')[0]?.trim() ?? '';

  if (isUsefulText(shortName) && STREET_PREFIX.test(shortName)) return shortName;
  if (isUsefulText(addressFirstLine) && STREET_PREFIX.test(addressFirstLine)) {
    return addressFirstLine;
  }
  if (isUsefulText(shortName)) return shortName;
  if (isUsefulText(addressFirstLine)) return addressFirstLine;
  return 'Dirección no disponible';
}

/** Final secondary address; never returns placeholders or bare coordinates. */
export function getPlaceReadableAddress(place: Pick<Place, 'name' | 'address' | 'labelStatus'>): string {
  const address = place.address.trim();
  if (isUsefulText(address)) return address;
  return getPlaceStreetName(place);
}
