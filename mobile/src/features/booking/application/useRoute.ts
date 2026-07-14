/**
 * Trayecto (ruta por calles + distancia/duración) entre origen y destino,
 * cacheado con react-query y keyed por las coordenadas de ambos puntos.
 */
import { useQuery } from '@tanstack/react-query';

import type { Place } from '@/features/booking/domain/types';
import { fetchRoute, type RouteResult } from '@/features/booking/data/routesService';

export function useRoute(
  origin: Place | null,
  destination: Place | null,
): { route: RouteResult | null; isLoading: boolean } {
  const o = origin?.coordinates;
  const d = destination?.coordinates;

  const query = useQuery({
    queryKey: ['route', o?.latitude, o?.longitude, d?.latitude, d?.longitude],
    queryFn: () => fetchRoute(o!, d!),
    enabled: Boolean(o && d),
    // Al cambiar alguno de los puntos no reutilizamos visualmente la ruta
    // previa mientras se obtiene la nueva.
    placeholderData: undefined,
    staleTime: 5 * 60_000,
  });

  return { route: query.data ?? null, isLoading: query.isFetching };
}
