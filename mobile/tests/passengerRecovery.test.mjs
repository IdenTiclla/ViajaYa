import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmRecovery } from '../src/features/home/application/confirmRecovery.ts';

const exito = (data = null) => ({ isSuccess: true, data, error: null });

test('sin viaje activo verifica la calificación y permite terminar la carga', async () => {
  const llamadas = [];
  await confirmRecovery(
    async () => { llamadas.push('activo'); return exito(); },
    async () => { llamadas.push('calificación'); return exito(); },
  );
  assert.deepEqual(llamadas, ['activo', 'calificación']);
});

test('un viaje vigente conserva prioridad sobre calificaciones antiguas', async () => {
  await confirmRecovery(
    async () => exito({ id: 'vigente' }),
    async () => assert.fail('No debe recuperar una calificación con viaje activo'),
  );
});

for (const etapa of ['activo', 'calificación']) {
  test(`una consulta de ${etapa} bloqueada termina con error y permite reintentar`, async () => {
    const bloqueada = () => new Promise(() => {});
    await assert.rejects(confirmRecovery(
      etapa === 'activo' ? bloqueada : async () => exito(),
      bloqueada,
      10,
    ), /La verificación tardó demasiado/);
    await confirmRecovery(async () => exito(), async () => exito());
  });
}

test('un error de consulta no se interpreta como ausencia de viaje', async () => {
  const error = new Error('Servidor inaccesible');
  await assert.rejects(confirmRecovery(
    async () => ({ isSuccess: false, error }),
    async () => assert.fail('No debe consultar calificaciones tras el error'),
  ), error);
});

test('una respuesta posterior al límite no inicia otra consulta', async () => {
  let resolver;
  const pendiente = new Promise((resolve) => { resolver = resolve; });
  let calificaciones = 0;
  await assert.rejects(confirmRecovery(
    () => pendiente,
    async () => { calificaciones += 1; return exito(); },
    10,
  ), /La verificación tardó demasiado/);
  resolver(exito());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calificaciones, 0);
});
