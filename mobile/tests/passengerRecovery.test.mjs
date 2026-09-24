import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmRecovery } from '../src/features/home/application/confirmRecovery.ts';

const success = (data = null) => ({ isSuccess: true, data, error: null });

test('without an active ride it checks the rating and lets loading finish', async () => {
  const calls = [];
  await confirmRecovery(
    async () => { calls.push('activo'); return success(); },
    async () => { calls.push('calificación'); return success(); },
  );
  assert.deepEqual(calls, ['activo', 'calificación']);
});

test('a current ride keeps priority over old ratings', async () => {
  await confirmRecovery(
    async () => success({ id: 'vigente' }),
    async () => assert.fail('Must not recover a rating while a ride is active'),
  );
});

for (const stage of ['activo', 'calificación']) {
  test(`a blocked ${stage} query ends with an error and allows retrying`, async () => {
    const blocked = () => new Promise(() => {});
    await assert.rejects(confirmRecovery(
      stage === 'activo' ? blocked : async () => success(),
      blocked,
      10,
    ), /La verificación tardó demasiado/);
    await confirmRecovery(async () => success(), async () => success());
  });
}

test('a query error is not interpreted as having no ride', async () => {
  const error = new Error('Servidor inaccesible');
  await assert.rejects(confirmRecovery(
    async () => ({ isSuccess: false, error }),
    async () => assert.fail('Must not query ratings after the error'),
  ), error);
});

test('a response after the limit does not start another query', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let ratings = 0;
  await assert.rejects(confirmRecovery(
    () => pending,
    async () => { ratings += 1; return success(); },
    10,
  ), /La verificación tardó demasiado/);
  release(success());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ratings, 0);
});
