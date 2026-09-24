/**
 * Place search with autocomplete for the destination screen.
 *
 * Debounces the typed text and queries Google Places through
 * react-query (cached per term). Keeps a stable `sessionToken` for
 * the whole search session and exposes `resolve()` to turn the chosen
 * prediction into a `Place` with coordinates, recycling the token at the end.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Coordinates, Place, PlaceSuggestion } from '@/features/booking/domain/types';
import { autocomplete, newSessionToken, placeDetails } from '@/features/booking/data/placesService';

/** ms to wait after the last keystroke before querying the API. */
const DEBOUNCE_MS = 300;
/** Minimum number of characters to trigger a search. */
const MIN_QUERY_LENGTH = 3;

type PlaceSearch = {
  suggestions: PlaceSuggestion[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** `true` when there is a searchable term (≥ the minimum characters). */
  isActive: boolean;
  retry: () => void;
  /** Resolve a prediction's coordinates; propagates an error if it fails. */
  resolve: (suggestion: PlaceSuggestion) => Promise<Place | null>;
};

export function usePlaceSearch(query: string, bias?: Coordinates): PlaceSearch {
  const normalized = query.trim();
  const debounced = useDebounced(normalized, DEBOUNCE_MS);
  const isActive = normalized.length >= MIN_QUERY_LENGTH;
  const isDebouncing = isActive && normalized !== debounced;
  const searchEnabled = debounced.length >= MIN_QUERY_LENGTH;

  // One token per search session; it is renewed when a selection is resolved.
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

/** Return `value` delayed by `delay` ms after the last change. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
