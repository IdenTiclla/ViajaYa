import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import { writeRealtimeQueryData } from '../src/features/rides/application/realtimeQueryCache.ts';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('una respuesta HTTP vieja no pisa la escritura posterior del WebSocket', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ['ride-offers', 'ride-1'];
  const oldHttp = deferred();
  const started = deferred();

  const request = queryClient.fetchQuery({
    queryKey,
    queryFn: () => {
      started.resolve();
      return oldHttp.promise;
    },
  });
  const settledRequest = request.catch(() => undefined);
  await started.promise;

  await writeRealtimeQueryData(queryClient, queryKey, ['ws-current']);
  oldHttp.resolve(['http-old']);
  await settledRequest;

  assert.deepEqual(queryClient.getQueryData(queryKey), ['ws-current']);
  queryClient.clear();
});
