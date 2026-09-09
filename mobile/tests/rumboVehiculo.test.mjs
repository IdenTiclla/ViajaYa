import assert from 'node:assert/strict';
import test from 'node:test';

import { calcularRotacionVehiculo, esRumboValido } from '../src/features/driver/presentation/rumboVehiculo.ts';

test('el vehículo cruza el norte en ambos sentidos sin una vuelta completa', () => {
  assert.equal(calcularRotacionVehiculo(350, 10), 370);
  assert.equal(calcularRotacionVehiculo(10, 350), -10);
  assert.equal(calcularRotacionVehiculo(720, 10), 730);
  assert.equal(calcularRotacionVehiculo(-720, 350), -730);
});

test('el frente del dibujo coincide con los puntos cardinales sin compensar el icono anterior', () => {
  for (const rumbo of [0, 90, 180, 270]) {
    const rotacion = calcularRotacionVehiculo(0, rumbo);
    assert.equal(((rotacion % 360) + 360) % 360, rumbo);
    assert.ok(Math.abs(rotacion) <= 180);
  }
});

test('un rumbo ausente o inválido no inventa una orientación ni contamina la siguiente rotación', () => {
  for (const rumbo of [null, -1, 360, NaN, Infinity, -Infinity]) {
    assert.equal(esRumboValido(rumbo), false);
    assert.equal(calcularRotacionVehiculo(120, rumbo), 120);
  }
  assert.equal(esRumboValido(0), true);
  assert.equal(esRumboValido(359.9), true);
  assert.equal(calcularRotacionVehiculo(120, 150), 150);
});
