/**
 * The passenger's saved places from the API (`/saved-places`).
 *
 * Exposes the list (react-query) and the create/edit/delete mutations,
 * which invalidate the query to refresh the UI. It keeps loading,
 * error and refreshing separate so a network failure is not presented as an empty list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  savedPlacesRepository,
  type SavePlaceInput,
} from '@/features/booking/data/savedPlacesRepository';
import type { SavedPlace, SavedPlaceCategory } from '@/features/booking/domain/types';

const QUERY_KEY = ['saved-places'];

export function useSavedPlaces(): {
  places: SavedPlace[];
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => savedPlacesRepository.list(),
    staleTime: 60_000,
  });

  return {
    places: query.data ?? [],
    isLoading: query.isPending,
    isRefreshing: query.isRefetching,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/** Return the most recent saved place of a category (Home/Work), if any. */
export function findByCategory(
  places: SavedPlace[],
  category: SavedPlaceCategory,
): SavedPlace | undefined {
  return places.find((p) => p.category === category);
}

export function useSavePlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id?: string; input: SavePlaceInput }) =>
      vars.id
        ? savedPlacesRepository.update(vars.id, vars.input)
        : savedPlacesRepository.create(vars.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeletePlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => savedPlacesRepository.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
