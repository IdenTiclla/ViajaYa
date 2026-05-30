/**
 * Lugares guardados del pasajero desde la API (`/saved-places`).
 *
 * Expone la lista (react-query) y las mutaciones para crear/editar/eliminar,
 * que invalidan la consulta para refrescar la UI. Devuelve `[]` mientras carga
 * o ante un error, de modo que la UI muestre su estado vacío sin romperse.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  savedPlacesRepository,
  type SavePlaceInput,
} from '@/features/booking/data/savedPlacesRepository';
import type { SavedPlace, SavedPlaceCategory } from '@/features/booking/domain/types';

const QUERY_KEY = ['saved-places'];

export function useSavedPlaces(): { places: SavedPlace[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => savedPlacesRepository.list(),
    staleTime: 60_000,
  });

  return { places: query.data ?? [], isLoading: query.isPending };
}

/** Devuelve el lugar guardado más reciente de una categoría (Home/Work), si existe. */
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
