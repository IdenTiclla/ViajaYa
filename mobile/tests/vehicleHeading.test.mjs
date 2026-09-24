import assert from 'node:assert/strict';
import test from 'node:test';

import { computeVehicleRotation, isValidHeading } from '../src/features/driver/presentation/vehicleHeading.ts';

test('the vehicle crosses north in both directions without a full turn', () => {
  assert.equal(computeVehicleRotation(350, 10), 370);
  assert.equal(computeVehicleRotation(10, 350), -10);
  assert.equal(computeVehicleRotation(720, 10), 730);
  assert.equal(computeVehicleRotation(-720, 350), -730);
});

test('the drawing\'s front matches the cardinal points without compensating for the previous icon', () => {
  for (const heading of [0, 90, 180, 270]) {
    const rotation = computeVehicleRotation(0, heading);
    assert.equal(((rotation % 360) + 360) % 360, heading);
    assert.ok(Math.abs(rotation) <= 180);
  }
});

test('a missing or invalid heading neither invents an orientation nor pollutes the next rotation', () => {
  for (const heading of [null, -1, 360, NaN, Infinity, -Infinity]) {
    assert.equal(isValidHeading(heading), false);
    assert.equal(computeVehicleRotation(120, heading), 120);
  }
  assert.equal(isValidHeading(0), true);
  assert.equal(isValidHeading(359.9), true);
  assert.equal(computeVehicleRotation(120, 150), 150);
});
