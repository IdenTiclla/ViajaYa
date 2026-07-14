/**
 * Búsqueda de lugares con autocompletado para la pantalla de destino.
 *
 * Aplica un debounce sobre el texto tecleado y consulta Google Places vía
 * react-query (cacheado por término). Mantiene un `sessionToken` estable para
 * toda la sesión de búsqueda y expone `resolve()` para convertir la predicción
 * elegida en un `Place` con coordenadas, reciclando el token al terminar.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Coordinates, Place, PlaceSuggestion } from '@/features/booking/domain/types';
import { autocomplete, newSessionToken, placeDetails } from '@/features/booking/data/placesService';

/** ms a esperar tras la última pulsación antes de consultar la API. */
const DEBOUNCE_MS = 300;
/** Mínimo de caracteres para disparar una búsqueda. */
const MIN_QUERY_LENGTH = 3;

type PlaceSearch = {
  suggestions: PlaceSuggestion[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** `true` cuando hay un término buscable (≥ mínimo de caracteres). */
  isActive: boolean;
  retry: () => void;
  /** Resuelve las coordenadas de una predicción; propaga un error si falla. */
  resolve: (suggestion: PlaceSuggestion) => Promise<Place | null>;
};

export function usePlaceSearch(query: string, bias?: Coordinates): PlaceSearch {
  const normalized = query.trim();
  const debounced = useDebounced(normalized, DEBOUNCE_MS);
  const isActive = normalized.length >= MIN_QUERY_LENGTH;
  const isDebouncing = isActive && normalized !== debounced;
  const searchEnabled = debounced.length >= MIN_QUERY_LENGTH;

  // Un token por sesión de búsqueda; se renueva al resolver una selección.
  const sessionToken = useRef(newSessionToken());

  const search = useQuery({
    queryKey: ['place-search', debounced, bias?.latitude, bias?.longitude],
    queryFn: () => autocomplete(debounced, sessionToken.current, bias),
    enabled: searchEnabled,
    staleTime: 60_000,
  });

  const resolve = useCallback(async (suggestion: PlaceSuggestion) => {
    const place = await placeDetails(suggestion, sessionToken.current);
    sessionToken.current = newSessionToken();
    return place;
  }, []);

  return {
    suggestions: isActive && !isDebouncing ? (search.data ?? []) : [],
    isLoading: isActive && (isDebouncing || search.isFetching),
    isError: isActive && !isDebouncing && search.isError,
    error: search.error,
    isActive,
    retry: () => void search.refetch(),
    resolve,
  };
}

/** Devuelve `value` retrasado `delay` ms tras el último cambio. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
