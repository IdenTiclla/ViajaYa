/**
 * Acceso a la ubicación del dispositivo (expo-location) detrás de un puerto
 * sencillo, para aislar la UI del SDK y poder mockearlo en tests.
 */
import * as Location from 'expo-location';

export type Coordinates = { latitude: number; longitude: number };

export type LocationResult =
  | { status: 'granted'; coordinates: Coordinates }
  | { status: 'denied' };

/** Etiqueta legible de un punto: nombre corto + dirección secundaria. */
export type PlaceLabel = { name: string; address: string };

function formatCoords({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// Plus Codes de Google (p. ej. "6R66+9P5"): bloque alfanumérico + '+' + sufijo.
// No los queremos como etiqueta; preferimos la calle y el número.
const PLUS_CODE_RE = /\b[A-Z0-9]{4,}\+[A-Z0-9]{2,}\b/i;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !PLUS_CODE_RE.test(trimmed) ? trimmed : null;
}

export const locationService = {
  /**
   * Solicita el permiso de ubicación en uso y devuelve la posición actual.
   * Si el usuario lo deniega, regresa `{ status: 'denied' }` (sin lanzar).
   */
  async getCurrentLocation(): Promise<LocationResult> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      return { status: 'denied' };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      status: 'granted',
      coordinates: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
    };
  },

  /**
   * Geocodificación inversa: convierte coordenadas en una etiqueta legible.
   *
   * Devuelve siempre una forma literal — **calle y número** como `name`, y el
   * resto (barrio/ciudad) como `address` — ignorando Plus Codes y otros códigos.
   * Si el geocoder no devuelve nada o falla, cae a las coordenadas formateadas
   * (nunca lanza, para no romper el flujo de selección en el mapa).
   */
  async reverseGeocode(coordinates: Coordinates): Promise<PlaceLabel> {
    try {
      const [result] = await Location.reverseGeocodeAsync(coordinates);
      if (!result) return { name: 'Ubicación seleccionada', address: formatCoords(coordinates) };

      const street = clean(result.street);
      // Calle + número de casa (si lo hay): "Av. Perú 1500".
      const streetLine =
        street && result.streetNumber ? `${street} ${result.streetNumber}` : street;

      // Partes en orden de prioridad, sin códigos ni duplicados.
      const ordered = [streetLine, clean(result.district), clean(result.city), clean(result.region)]
        .filter((p): p is string => Boolean(p))
        .filter((p, i, all) => all.indexOf(p) === i);

      if (ordered.length === 0) {
        return { name: clean(result.name) ?? 'Ubicación seleccionada', address: formatCoords(coordinates) };
      }

      return {
        name: ordered[0],
        address: ordered.slice(1).join(', ') || formatCoords(coordinates),
      };
    } catch {
      return { name: 'Ubicación seleccionada', address: formatCoords(coordinates) };
    }
  },
};
