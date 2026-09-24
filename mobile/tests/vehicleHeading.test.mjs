import assert from 'node:assert/strict';
import test from 'node:test';

import { computeVehicleRotation, isValidHeading } from '../src/features/driver/presentation/vehicleHeading.ts';

test('el vehículo cruza el norte en ambos sentidos sin una vuelta completa', () => {
  assert.equal(computeVehicleRotation(350, 10), 370);
  assert.equal(computeVehicleRotation(10, 350), -10);
  assert.equal(computeVehicleRotation(720, 10), 730);
  assert.equal(computeVehicleRotation(-720, 350), -730);
});

test('el frente del dibujo coincide con los puntos cardinales sin compensar el icono anterior', () => {
  for (const rumbo of [0, 90, 180, 270]) {
    const rotacion = computeVehicleRotation(0, rumbo);
    assert.equal(((rotacion % 360) + 360) % 360, rumbo);
    assert.ok(Math.abs(rotacion) <= 180);
  }
});

test('un rumbo ausente o inválido no inventa una orientación ni contamina la siguiente rotación', () => {
  for (const rumbo of [null, -1, 360, NaN, Infinity, -Infinity]) {
    assert.equal(isValidHeading(rumbo), false);
    assert.equal(computeVehicleRotation(120, rumbo), 120);
  }
  assert.equal(isValidHeading(0), true);
  assert.equal(isValidHeading(359.9), true);
  assert.equal(computeVehicleRotation(120, 150), 150);
});
