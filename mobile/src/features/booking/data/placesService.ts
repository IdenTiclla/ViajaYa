/**
 * Búsqueda de lugares por texto vía Google Places API (new), usando la misma
 * API key de Maps que `routesService`.
 *
 * El flujo es en dos pasos para no malgastar cuota:
 *  1. `autocomplete(query)` → lista de predicciones (placeId + etiquetas), que se
 *     pide a cada pulsación (con debounce en el hook).
 *  2. `placeDetails(placeId)` → coordenadas reales, solo cuando el usuario elige
 *     una predicción.
 *
 * Ambos comparten un `sessionToken` para que Google los facture como una sola
 * sesión de autocompletado. Los fallos se propagan para que la UI no confunda
 * un problema de red o configuración con una búsqueda sin resultados.
 */
import * as Crypto from 'expo-crypto';

import { env } from '@/core/config/env';
import {
  getBoliviaPlaceError,
} from '@/features/booking/domain/bolivia';
import type { Coordinates, Place, PlaceSuggestion } from '@/features/booking/domain/types';

const AUTOCOMPLETE_ENDPOINT = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places';

/** Radio (m) alrededor del origen para priorizar resultados cercanos. */
const BIAS_RADIUS_METERS = 50_000;

/** Crea un token de sesión para enlazar autocompletado + detalle de un lugar. */
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
 * Busca lugares que coincidan con `query`. Sesga los resultados hacia `bias`
 * (normalmente el origen) cuando se proporciona, para que aparezcan primero los
 * lugares cercanos.
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
        name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? 'Lugar',
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
  addressComponents?: { shortText?: string; types?: string[] }[];
};

/**
 * Resuelve las coordenadas (y etiquetas finales) de una predicción. Conserva el
 * `name`/`address` ya mostrados si la respuesta no trae uno mejor, para que la
 * fila elegida no "salte" visualmente.
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
        ?.shortText?.toUpperCase() ?? null;

    const place: Place = {
      coordinates: { latitude, longitude },
      name: suggestion.name || data.displayName?.text || 'Lugar',
      address: suggestion.address || data.formattedAddress || '',
      countryCode,
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
