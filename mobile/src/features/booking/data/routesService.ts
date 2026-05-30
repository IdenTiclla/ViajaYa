/**
 * Cálculo del trayecto entre dos puntos vía Google Routes API
 * (`directions/v2:computeRoutes`), usando la misma API key de Maps.
 *
 * Devuelve la geometría de la ruta (para dibujar la polilínea por calles) más
 * la distancia y duración estimadas. Pide la polilínea como GeoJSON LineString
 * para no depender de un decodificador de polilíneas codificadas.
 *
 * Nunca lanza: ante un fallo (key restringida, sin red, sin ruta) devuelve
 * `null` y la UI cae a una línea recta entre origen y destino.
 */
import { env } from '@/core/config/env';
import type { Coordinates } from '@/features/booking/domain/types';

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

export type RouteResult = {
  coordinates: Coordinates[];
  distanceMeters: number;
  durationSeconds: number;
};

type LatLng = { latitude: number; longitude: number };

function waypoint({ latitude, longitude }: Coordinates): { location: { latLng: LatLng } } {
  return { location: { latLng: { latitude, longitude } } };
}

export async function fetchRoute(
  origin: Coordinates,
  destination: Coordinates,
): Promise<RouteResult | null> {
  const apiKey = env.googleMapsApiKey;
  if (!apiKey) return null;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'routes.polyline.geoJsonLinestring,routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: waypoint(origin),
        destination: waypoint(destination),
        travelMode: 'DRIVE',
        polylineEncoding: 'GEO_JSON_LINESTRING',
      }),
    });
    if (!response.ok) return null;

    const data = await response.json();
    const route = data?.routes?.[0];
    const lineString: [number, number][] | undefined = route?.polyline?.geoJsonLinestring?.coordinates;
    if (!Array.isArray(lineString) || lineString.length === 0) return null;

    return {
      // GeoJSON viene como [lng, lat]; react-native-maps usa {latitude, longitude}.
      coordinates: lineString.map(([longitude, latitude]) => ({ latitude, longitude })),
      distanceMeters: typeof route.distanceMeters === 'number' ? route.distanceMeters : 0,
      durationSeconds: Number.parseInt(String(route.duration ?? '0'), 10) || 0,
    };
  } catch {
    return null;
  }
}
