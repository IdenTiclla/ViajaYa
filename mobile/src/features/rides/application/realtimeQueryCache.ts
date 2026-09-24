import type { QueryClient, QueryKey, Updater } from '@tanstack/react-query';

/**
 * Apply a write coming from the WebSocket after cancelling any
 * exact GET in flight, so an older response does not restore stale data.
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
