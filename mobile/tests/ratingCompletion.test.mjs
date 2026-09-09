import assert from 'node:assert/strict';
import test from 'node:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import { actualizarTrasCalificacion } from '../src/features/rides/application/actualizarTrasCalificacion.ts';

const key = ['pending-rating-ride'];

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
    onSuccess: () => actualizarTrasCalificacion(client, 'terminado'),
  });
  await mutation.mutate();
  assert.equal(mutation.getCurrentResult().status, 'success');
  assert.equal(consultas, 2);
  assert.equal(client.getQueryData(key), null);
  resolver({ id: 'terminado' });
  await lecturaAnterior;
  assert.equal(client.getQueryData(key), null);
});

test('cerrar una calificación no elimina otro viaje pendiente', (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  client.setQueryData(key, { id: 'otro' });
  actualizarTrasCalificacion(client, 'terminado');
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
  actualizarTrasCalificacion(client, 'terminado');
  await lectura;
  assert.deepEqual(client.getQueryData(key), { id: 'otro' });
});
