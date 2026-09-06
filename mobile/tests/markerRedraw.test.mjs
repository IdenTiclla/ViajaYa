import assert from 'node:assert/strict';
import test from 'node:test';

import { programarRedibujadoMarcador } from '../src/features/rides/presentation/routeTooltipLayout.ts';

function frames() {
  let siguiente = 0;
  const pendientes = new Map();
  return {
    pedir(callback) { const id = ++siguiente; pendientes.set(id, callback); return id; },
    cancelar(id) { pendientes.delete(id); },
    avanzar() {
      const actuales = [...pendientes.values()];
      pendientes.clear();
      actuales.forEach((callback) => callback());
    },
    cantidad: () => pendientes.size,
  };
}

test('espera dos frames antes de solicitar la captura del marcador', () => {
  const reloj = frames();
  let layout = 'incompleto';
  const capturas = [];
  programarRedibujadoMarcador(() => capturas.push(layout), reloj.pedir, reloj.cancelar);
  assert.deepEqual(capturas, []);
  reloj.avanzar();
  assert.deepEqual(capturas, []);
  layout = 'pin y tooltip completos';
  reloj.avanzar();
  assert.deepEqual(capturas, ['pin y tooltip completos']);
  assert.equal(reloj.cantidad(), 0);
});

for (const transcurridos of [0, 1]) {
  test(`desmontar tras ${transcurridos} frames cancela el redibujado pendiente`, () => {
    const reloj = frames();
    const cancelar = programarRedibujadoMarcador(
      () => assert.fail('No debe tocar un marcador desmontado'), reloj.pedir, reloj.cancelar,
    );
    if (transcurridos) reloj.avanzar();
    cancelar();
    reloj.avanzar();
    reloj.avanzar();
    assert.equal(reloj.cantidad(), 0);
  });
}

test('una etiqueta nueva reemplaza el redibujado anterior sin volver a la pantalla', () => {
  const reloj = frames();
  const capturas = [];
  const cancelar = programarRedibujadoMarcador(
    () => capturas.push('anterior'), reloj.pedir, reloj.cancelar,
  );
  reloj.avanzar();
  cancelar();
  programarRedibujadoMarcador(() => capturas.push('nueva'), reloj.pedir, reloj.cancelar);
  reloj.avanzar();
  reloj.avanzar();
  assert.deepEqual(capturas, ['nueva']);
});
