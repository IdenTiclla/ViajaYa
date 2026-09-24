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

test('una calificación guardada termina aunque la lectura siguiente quede bloqueada', async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => client.clear());
  let resolver;
  let consultas = 0;
  const lecturaAnterior = client.fetchQuery({
    queryKey: key,
    queryFn: () => new Promise((resolve) => {
      consultas += 1;
      if (consultas === 1) resolver = resolve;
    }),
  }).catch(() => undefined);
  client.setQueryData(key, { id: 'terminado' });
  const mutation = new MutationObserver(client, {
    mutationFn: async () => undefined,
    onSuccess: () => refreshAfterRating(client, 'terminado'),
  });
  await mutation.mutate();
  assert.equal(mutation.getCurrentResult().status, 'success');
  assert.equal(consultas, 2);
  assert.equal(client.getQueryData(key), null);
  resolver({ id: 'terminado' });
  await lecturaAnterior;
  assert.equal(client.getQueryData(key), null);
});

test('cerrar una calificación no elimina otro viaje pendiente', async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  client.setQueryData(key, { id: 'otro' });
  await refreshAfterRating(client, 'terminado');
  assert.deepEqual(client.getQueryData(key), { id: 'otro' });
});

test('cancelar una lectura antigua conserva un pendiente recibido mientras estaba en vuelo', async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  client.setQueryData(key, { id: 'terminado' });
  const lectura = client.fetchQuery({
    queryKey: key,
    queryFn: () => new Promise(() => {}),
  }).catch(() => undefined);
  client.setQueryData(key, { id: 'otro' });
  await refreshAfterRating(client, 'terminado');
  await lectura;
  assert.deepEqual(client.getQueryData(key), { id: 'otro' });
});
