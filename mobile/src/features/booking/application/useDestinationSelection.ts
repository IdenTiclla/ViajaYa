import { useCallback, useEffect, useRef, useState } from 'react';

import { withTimeout } from '@/core/async/withTimeout';
import { getBoliviaPlaceError } from '@/features/booking/domain/bolivia';
import type { Place, PlaceSuggestion } from '@/features/booking/domain/types';

/** Only the current selection can set a destination or show an error. */
export function useDestinationSelection(
  resolver: (suggestion: PlaceSuggestion) => Promise<Place | null>,
  onSelect: (place: Place) => void,
) {
  const generation = useRef(0);
  const inProgress = useRef(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => () => { generation.current += 1; }, []);

  const cancelSelection = useCallback(() => {
    generation.current += 1;
    inProgress.current = false;
    setResolvingId(null);
    setSelectionError(null);
  }, []);

  const selectPlace = useCallback((place: Place) => {
    cancelSelection();
    const error = getBoliviaPlaceError(place);
    if (error) setSelectionError(error);
    else onSelect(place);
  }, [onSelect, cancelSelection]);

  const selectSuggestion = useCallback(async (suggestion: PlaceSuggestion) => {
    if (inProgress.current) return;
    inProgress.current = true;
    const request = ++generation.current;
    setResolvingId(suggestion.placeId);
    setSelectionError(null);
    try {
      const place = await withTimeout(
        resolver(suggestion), 30_000,
        'La ubicación tardó demasiado. Vuelve a intentarlo o elige el punto en el mapa.',
      );
      if (request !== generation.current) return;
      if (!place) throw new Error('No pudimos ubicar este lugar. Prueba otra opción o usa el mapa.');
      const error = getBoliviaPlaceError(place);
      if (error) throw new Error(error);
      onSelect(place);
    } catch (error) {
      if (request === generation.current) {
        setSelectionError(error instanceof Error ? error.message : 'No pudimos obtener la ubicación. Vuelve a intentarlo.');
      }
    } finally {
      if (request === generation.current) {
        inProgress.current = false;
        setResolvingId(null);
      }
    }
  }, [onSelect, resolver]);

  return { resolvingId, selectionError, selectSuggestion, selectPlace, cancelSelection };
}
