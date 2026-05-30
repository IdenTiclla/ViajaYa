/**
 * Destinos recientes del pasajero desde la API (`/rides/recent-destinations`).
 *
 * Devuelve `[]` mientras carga o ante un error, de modo que la UI muestre su
 * estado vacío sin romperse si el backend no responde.
 */
import { useQuery } from '@tanstack/react-query';

import type { Place } from '@/features/booking/domain/types';
import { ridesRepository } from '@/features/booking/data/ridesRepository';

export function useRecentDestinations(): { places: Place[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['recent-destinations'],
    queryFn: () => ridesRepository.recentDestinations(),
    staleTime: 60_000,
  });

  return { places: query.data ?? [], isLoading: query.isPending };
}
