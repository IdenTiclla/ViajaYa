/** Traffic-aware road routing through the shared HTTP client. */
import { isAxiosError, isCancel } from 'axios';

import { env } from '@/core/config/env';
import { api } from '@/core/http/client';
import { routeTravelMode } from '../domain/routeTravelMode';
import { selectOptimalRoute, type RouteResult } from '../domain/optimalRoute';
import type { ServiceType, Coordinates } from '@/features/booking/domain/types';

export type { RouteResult } from '../domain/optimalRoute';

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const SERVICE_UNAVAILABLE = 'El servicio de rutas no está disponible en este momento. Intenta de nuevo en unos segundos.';

type LatLng = { latitude: number; longitude: number };

function waypoint({ latitude, longitude }: Coordinates): { location: { latLng: LatLng } } {
  return { location: { latLng: { latitude, longitude } } };
}

export async function fetchRoute(
  origin: Coordinates,
  destination: Coordinates,
  service: ServiceType,
  signal?: AbortSignal,
): Promise<RouteResult | null> {
  const apiKey = env.googleMapsApiKey;
  if (!apiKey) throw new Error(SERVICE_UNAVAILABLE);

  let data;
  try {
    const response = await api.post(ENDPOINT, {
      origin: waypoint(origin),
      destination: waypoint(destination),
      travelMode: routeTravelMode(service),
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      computeAlternativeRoutes: true,
      polylineQuality: 'HIGH_QUALITY',
      polylineEncoding: 'GEO_JSON_LINESTRING',
    }, {
      // Provider requests must never carry ViajaYa access tokens or refresh them.
      skipAuth: true,
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'routes.polyline.geoJsonLinestring,routes.distanceMeters,routes.duration',
      },
    });
    data = response.data;
  } catch (error) {
    if (isCancel(error) || signal?.aborted) throw error;
    if (isAxiosError(error) && !error.response) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new Error('El cálculo de la ruta tardó demasiado. Intenta de nuevo.');
      }
      throw new Error('No pudimos conectar con el servicio de rutas. Revisa tu conexión e inténtalo de nuevo.');
    }
    throw new Error(SERVICE_UNAVAILABLE);
  }
  // An empty successful response means no route; malformed geometry is a
  // provider response failure, never evidence of a disconnected driver.
  if (data && typeof data === 'object' && (data.routes === undefined
    || (Array.isArray(data.routes) && data.routes.length === 0))) return null;
  const route = selectOptimalRoute(Array.isArray(data?.routes) ? data.routes : []);
  if (!route) throw new Error('El servicio de rutas devolvió un trayecto incompleto. Intenta de nuevo.');
  return route;
}
