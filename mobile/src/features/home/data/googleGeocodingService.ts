/** HTTP geocoding fallback for devices whose native geocoder fails. */
import { api } from '@/core/http/client';
import { env } from '@/core/config/env';
import type { Coordinates, PlaceLabel } from '@/core/domain/geo';

const GOOGLE_GEOCODING_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLUS_CODE_RE = /\b[A-Z0-9]{4,}\+[A-Z0-9]{2,}\b/i;
const UNNAMED_STREET_RE = /^(?:unnamed road|calle sin nombre|v[ií]a sin nombre|camino sin nombre)$/i;

export type GeocodingQuality = 'area' | 'place' | 'street';

export type GoogleGeocodingResult = {
  label: PlaceLabel;
  quality: GeocodingQuality;
};

const requests = new Map<string, Promise<GoogleGeocodingResult | null>>();

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
  return trimmed && !PLUS_CODE_RE.test(trimmed) && !UNNAMED_STREET_RE.test(trimmed)
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

function namedStreet(result: GeocodingResult): string | null {
  const route = component(result, 'route');
  return route && !UNNAMED_STREET_RE.test(route) ? route : null;
}

function toLabel(result: GeocodingResult): PlaceLabel | null {
  const formattedParts = (result.formatted_address ?? '')
    .split(',')
    .map(clean)
    .filter((part): part is string => Boolean(part));
  const route = namedStreet(result);
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

function resultQuality(result: GeocodingResult): GeocodingQuality {
  const resultTypes = new Set(result.types ?? []);
  const firstLine = clean(result.formatted_address?.split(',')[0]);
  const firstLineIsUnnamedStreet = Boolean(
    firstLine && UNNAMED_STREET_RE.test(firstLine),
  );

  if (
    namedStreet(result) ||
    (firstLine &&
      !firstLineIsUnnamedStreet &&
      (resultTypes.has('street_address') || resultTypes.has('intersection')))
  ) {
    return 'street';
  }
  if (
    resultTypes.has('point_of_interest') ||
    resultTypes.has('establishment') ||
    resultTypes.has('premise') ||
    resultTypes.has('subpremise')
  ) {
    return 'place';
  }
  return 'area';
}

function selectBestResult(
  results: GeocodingResult[],
): GoogleGeocodingResult | null {
  let bestPlace: GoogleGeocodingResult | null = null;
  let bestArea: GoogleGeocodingResult | null = null;

  for (const result of results) {
    if (result.types?.includes('plus_code')) continue;
    const label = toLabel(result);
    if (!label) continue;
    const quality = resultQuality(result);
    const candidate = { label, quality };

    // The first street keeps the closeness/relevance of Google's order. We do not
    // displace a nearby street just because a later one has house numbers.
    if (quality === 'street') return candidate;
    if (quality === 'place' && !bestPlace) bestPlace = candidate;
    if (quality === 'area' && !bestArea) bestArea = candidate;
  }

  return bestPlace ?? bestArea;
}

async function requestGoogle(
  coordinates: Coordinates,
): Promise<GoogleGeocodingResult | null> {
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
    return selectBestResult(data.results ?? []);
  } catch {
    return null;
  }
}

export function reverseGeocodeWithGoogle(
  coordinates: Coordinates,
): Promise<GoogleGeocodingResult | null> {
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
