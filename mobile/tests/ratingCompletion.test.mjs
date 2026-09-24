import assert from 'node:assert/strict';
import test from 'node:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import { refreshAfterRating } from '../src/features/rides/application/refreshAfterRating.ts';

const key = ['pending-rating-ride'];

test('driver rating clears cancelled recovery without leaving an error in the pool gate', async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => client.clear());
  const keys = [['pending-rating-ride'], ['driver-active-ride']];
  const reads = keys.map(queryKey => {
    client.setQueryData(queryKey, { id: 'finished', status: 'completed' });
    return client.fetchQuery({ queryKey, queryFn: () => new Promise(() => {}) }).catch(() => undefined);
  });
  await refreshAfterRating(client, 'finished');
  for (const queryKey of keys) {
    assert.equal(client.getQueryData(queryKey), null);
    assert.equal(client.getQueryState(queryKey).status, 'success');
    assert.equal(client.getQueryState(queryKey).error, null);
  }
  await Promise.all(reads);
});

test('a saved rating finishes even if the next read stays blocked', async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => client.clear());
  let release;
  let queryCount = 0;
  const previousRead = client.fetchQuery({
    queryKey: key,
    queryFn: () => new Promise((resolve) => {
      queryCount += 1;
      if (queryCount === 1) release = resolve;
    }),
  }).catch(() => undefined);
  client.setQueryData(key, { id: 'terminado' });
  const mutation = new MutationObserver(client, {
    mutationFn: async () => undefined,
    onSuccess: () => refreshAfterRating(client, 'terminado'),
  });
  await mutation.mutate();
  assert.equal(mutation.getCurrentResult().status, 'success');
  assert.equal(queryCount, 2);
  assert.equal(client.getQueryData(key), null);
  release({ id: 'terminado' });
  await previousRead;
  assert.equal(client.getQueryData(key), null);
});

test('closing a rating does not remove another pending ride', async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  client.setQueryData(key, { id: 'otro' });
  await refreshAfterRating(client, 'terminado');
  assert.deepEqual(client.getQueryData(key), { id: 'otro' });
});

test('cancelling an old read keeps a pending item received while it was in flight', async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  client.setQueryData(key, { id: 'terminado' });
  const read = client.fetchQuery({
    queryKey: key,
    queryFn: () => new Promise(() => {}),
  }).catch(() => undefined);
  client.setQueryData(key, { id: 'otro' });
  await refreshAfterRating(client, 'terminado');
  await read;
  assert.deepEqual(client.getQueryData(key), { id: 'otro' });
});
