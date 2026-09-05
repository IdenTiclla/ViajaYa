/** Respaldo HTTP de geocodificación para dispositivos cuyo geocoder nativo falla. */
import { api } from '@/core/http/client';
import { env } from '@/core/config/env';
import type { Coordinates, PlaceLabel } from '@/core/domain/geo';

const GOOGLE_GEOCODING_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLUS_CODE_RE = /\b[A-Z0-9]{4,}\+[A-Z0-9]{2,}\b/i;
const CALLE_SIN_NOMBRE_RE = /^(?:unnamed road|calle sin nombre|v[ií]a sin nombre|camino sin nombre)$/i;

export type CalidadGeocodificacion = 'area' | 'lugar' | 'calle';

export type ResultadoGeocodificacionGoogle = {
  etiqueta: PlaceLabel;
  calidad: CalidadGeocodificacion;
};

const requests = new Map<string, Promise<ResultadoGeocodificacionGoogle | null>>();

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GeocodingResult = {
  formatted_address?: string;
  address_components?: AddressComponent[];
  types?: string[];
};

type GeocodingResponse = {
  status?: string;
  results?: GeocodingResult[];
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !PLUS_CODE_RE.test(trimmed) && !CALLE_SIN_NOMBRE_RE.test(trimmed)
    ? trimmed
    : null;
}

function component(
  result: GeocodingResult,
  type: string,
  field: 'long_name' | 'short_name' = 'long_name',
): string | null {
  return clean(result.address_components?.find((item) => item.types?.includes(type))?.[field]);
}

function calleNombrada(result: GeocodingResult): string | null {
  const route = component(result, 'route');
  return route && !CALLE_SIN_NOMBRE_RE.test(route) ? route : null;
}

function toLabel(result: GeocodingResult): PlaceLabel | null {
  const formattedParts = (result.formatted_address ?? '')
    .split(',')
    .map(clean)
    .filter((part): part is string => Boolean(part));
  const route = calleNombrada(result);
  const streetNumber = component(result, 'street_number');
  const streetLine = route && streetNumber ? `${route} ${streetNumber}` : route;
  const name =
    streetLine ??
    component(result, 'point_of_interest') ??
    component(result, 'establishment') ??
    formattedParts[0] ??
    component(result, 'neighborhood') ??
    component(result, 'locality');
  if (!name) return null;

  return {
    name,
    address: formattedParts.join(', ') || name,
    countryCode: component(result, 'country', 'short_name')?.toUpperCase() ?? null,
  };
}

function calidadResultado(result: GeocodingResult): CalidadGeocodificacion {
  const tipos = new Set(result.types ?? []);
  const primeraLinea = clean(result.formatted_address?.split(',')[0]);
  const primeraLineaEsCalleSinNombre = Boolean(
    primeraLinea && CALLE_SIN_NOMBRE_RE.test(primeraLinea),
  );

  if (
    calleNombrada(result) ||
    (primeraLinea &&
      !primeraLineaEsCalleSinNombre &&
      (tipos.has('street_address') || tipos.has('intersection')))
  ) {
    return 'calle';
  }
  if (
    tipos.has('point_of_interest') ||
    tipos.has('establishment') ||
    tipos.has('premise') ||
    tipos.has('subpremise')
  ) {
    return 'lugar';
  }
  return 'area';
}

function seleccionarMejorResultado(
  resultados: GeocodingResult[],
): ResultadoGeocodificacionGoogle | null {
  let mejorLugar: ResultadoGeocodificacionGoogle | null = null;
  let mejorArea: ResultadoGeocodificacionGoogle | null = null;

  for (const resultado of resultados) {
    if (resultado.types?.includes('plus_code')) continue;
    const etiqueta = toLabel(resultado);
    if (!etiqueta) continue;
    const calidad = calidadResultado(resultado);
    const candidata = { etiqueta, calidad };

    // La primera calle conserva la cercanía/relevancia del orden de Google. No
    // desplazamos una vía cercana solo porque otra posterior tenga numeración.
    if (calidad === 'calle') return candidata;
    if (calidad === 'lugar' && !mejorLugar) mejorLugar = candidata;
    if (calidad === 'area' && !mejorArea) mejorArea = candidata;
  }

  return mejorLugar ?? mejorArea;
}

async function requestGoogle(
  coordinates: Coordinates,
): Promise<ResultadoGeocodificacionGoogle | null> {
  if (!env.googleMapsApiKey) return null;
  try {
    const { data } = await api.get<GeocodingResponse>(GOOGLE_GEOCODING_ENDPOINT, {
      skipAuth: true,
      timeout: 4_500,
      params: {
        latlng: `${coordinates.latitude},${coordinates.longitude}`,
        key: env.googleMapsApiKey,
        language: 'es',
        region: 'bo',
      },
    });
    if (data.status !== 'OK') return null;
    return seleccionarMejorResultado(data.results ?? []);
  } catch {
    return null;
  }
}

export function reverseGeocodeWithGoogle(
  coordinates: Coordinates,
): Promise<ResultadoGeocodificacionGoogle | null> {
  const key = `${coordinates.latitude.toFixed(5)},${coordinates.longitude.toFixed(5)}`;
  const active = requests.get(key);
  if (active) return active;

  const request = requestGoogle(coordinates);
  requests.set(key, request);
  void request.then(
    () => requests.delete(key),
    () => requests.delete(key),
  );
  return request;
}
