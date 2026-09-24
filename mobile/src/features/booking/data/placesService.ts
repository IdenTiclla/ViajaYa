/**
 * Place search by text through Google Places API (new), using the same
 * Maps API key as `routesService`.
 *
 * The flow has two steps so quota is not wasted:
 *  1. `autocomplete(query)` → list of predictions (placeId + labels),
 *     requested on every keystroke (debounced in the hook).
 *  2. `placeDetails(placeId)` → real coordinates, only when the user picks
 *     a prediction.
 *
 * Both share a `sessionToken` so Google bills them as a single
 * autocomplete session. Failures are propagated so the UI does not confuse
 * a network or configuration problem with a search without results.
 */
import * as Crypto from 'expo-crypto';

import { env } from '@/core/config/env';
import {
  getBoliviaPlaceError,
} from '@/features/booking/domain/bolivia';
import type { Coordinates, Place, PlaceSuggestion } from '@/features/booking/domain/types';
import { locationService } from '@/features/home/data/locationService';

const AUTOCOMPLETE_ENDPOINT = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places';
const CALLE_SIN_NOMBRE_RE = /^(?:unnamed road|calle sin nombre|v[ií]a sin nombre|camino sin nombre)$/i;

/** Radius (m) around the origin to prioritize nearby results. */
const BIAS_RADIUS_METERS = 50_000;

/** Create a session token to link autocomplete + a place's details. */
export function newSessionToken(): string {
  return Crypto.randomUUID();
}

type AutocompleteResponse = {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      text?: { text?: string };
    };
  }[];
};

/**
 * Search for places matching `query`. Biases the results toward `bias`
 * (usually the origin) when given, so nearby places show up
 * first.
 */
export async function autocomplete(
  query: string,
  sessionToken: string,
  bias?: Coordinates,
): Promise<PlaceSuggestion[]> {
  const apiKey = env.googleMapsApiKey;
  const input = query.trim();
  if (!input) return [];
  if (!apiKey) throw new Error('La búsqueda de lugares no está configurada.');

  try {
    const response = await fetch(AUTOCOMPLETE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        input,
        sessionToken,
        languageCode: 'es',
        regionCode: 'BO',
        includedRegionCodes: ['bo'],
        ...(bias && {
          locationBias: {
            circle: { center: bias, radius: BIAS_RADIUS_METERS },
          },
        }),
      }),
    });
    if (!response.ok) throw new Error('No pudimos consultar los lugares en este momento.');

    const data: AutocompleteResponse = await response.json();
    return (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .map((p) => ({
        placeId: p.placeId!,
        name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        address: p.structuredFormat?.secondaryText?.text ?? '',
      }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No pudimos')) throw error;
    throw new Error('Revisa tu conexión e intenta buscar nuevamente.');
  }
}

type DetailsResponse = {
  location?: { latitude?: number; longitude?: number };
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { shortText?: string; longText?: string; types?: string[] }[];
};

function addressComponentText(
  components: DetailsResponse['addressComponents'],
  type: string,
): string | null {
  const component = components?.find((item) => item.types?.includes(type));
  return component?.shortText?.trim() || component?.longText?.trim() || null;
}

function streetFromAddressComponents(
  components: DetailsResponse['addressComponents'],
): string | null {
  const street = addressComponentText(components, 'route');
  if (!street || CALLE_SIN_NOMBRE_RE.test(street)) return null;
  const number = addressComponentText(components, 'street_number');
  return number ? `${street} ${number}` : street;
}

/**
 * Resolve the coordinates (and final labels) of a prediction. Keeps the
 * `name`/`address` already shown if the response does not bring a better one, so the
 * chosen row does not visually "jump".
 */
export async function placeDetails(
  suggestion: PlaceSuggestion,
  sessionToken: string,
): Promise<Place | null> {
  const apiKey = env.googleMapsApiKey;
  if (!apiKey) throw new Error('La búsqueda de lugares no está configurada.');

  try {
    const url = `${DETAILS_ENDPOINT}/${encodeURIComponent(suggestion.placeId)}?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=es&regionCode=BO`;
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'location,displayName,formattedAddress,addressComponents',
      },
    });
    if (!response.ok) throw new Error('No pudimos obtener la ubicación seleccionada.');

    const data: DetailsResponse = await response.json();
    const { latitude, longitude } = data.location ?? {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new Error('La ubicación seleccionada no tiene coordenadas disponibles.');
    }

    const countryCode =
      data.addressComponents
        ?.find((component) => component.types?.includes('country'))
        ?.shortText?.trim()
        .toUpperCase() ?? null;
    const street = streetFromAddressComponents(data.addressComponents);
    const coordinates = { latitude, longitude };
    // Places may omit `route` for POIs, squares or neighborhoods. In that case we use
    // their coordinates to look up the nearby street before showing the generic name.
    const nearbyStreet = street
      ? null
      : await locationService.reverseGeocodeNearestStreet(coordinates);

    const place: Place = {
      coordinates,
      name:
        street ||
        nearbyStreet?.name ||
        data.displayName?.text?.trim() ||
        suggestion.name.trim() ||
        data.formattedAddress?.split(',')[0]?.trim() ||
        'Lugar',
      address: data.formattedAddress || nearbyStreet?.address || suggestion.address || '',
      countryCode: countryCode ?? nearbyStreet?.countryCode ?? null,
    };
    const areaError = getBoliviaPlaceError(place);
    if (areaError) throw new Error(areaError);
    return place;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('No pudimos') ||
        error.message.startsWith('La ubicación') ||
        error.message.startsWith('ViajaYa'))
    ) {
      throw error;
    }
    throw new Error('Revisa tu conexión e intenta seleccionar el lugar nuevamente.');
  }
}
