import type { QueryClient, QueryKey, Updater } from '@tanstack/react-query';

/**
 * Aplica una escritura proveniente del WebSocket después de cancelar cualquier
 * GET exacto en vuelo, para que una respuesta anterior no restaure datos viejos.
 */
export async function writeRealtimeQueryData<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: Updater<T | undefined, T | undefined>,
  isCurrent: () => boolean = () => true,
): Promise<T | undefined> {
  await queryClient.cancelQueries({ queryKey, exact: true });
  if (!isCurrent()) return queryClient.getQueryData<T>(queryKey);
  return queryClient.setQueryData<T>(queryKey, updater);
}
