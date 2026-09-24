import assert from 'node:assert/strict';
import test from 'node:test';

import { compassHeading, movementHeading } from '../src/features/home/domain/orientacionUbicacion.ts';

const muestra = (cambios = {}) => ({
  coordinates: { latitude: -16.5, longitude: -68.15 },
  heading: null, speed: null, precision: 3, timestamp: 10000, ...cambios,
});

test('el GPS orienta en movimiento y descarta el rumbo cero retenido al detenerse', () => {
  assert.equal(movementHeading(null, muestra({ heading: 90, speed: 8 })), 90);
  assert.equal(movementHeading(null, muestra({ heading: 0, speed: 0 })), null);
  assert.equal(movementHeading(null, muestra({ heading: 0, speed: 10 })), 0);
});

test('sin rumbo GPS calcula la dirección entre posiciones suficientemente separadas', () => {
  const anterior = muestra();
  const norte = muestra({ coordinates: { latitude: -16.4998, longitude: -68.15 }, timestamp: 11000 });
  const este = muestra({ coordinates: { latitude: -16.5, longitude: -68.1498 }, timestamp: 11000 });
  assert.equal(movementHeading(anterior, norte), 0);
  assert.ok(Math.abs(movementHeading(anterior, este) - 90) < 0.1);
  assert.equal(movementHeading(anterior, { ...norte, precision: 100 }), null);
  assert.equal(movementHeading(anterior, { ...norte, timestamp: 9000 }), null);
  assert.equal(movementHeading(anterior, { ...norte, timestamp: 40000 }), null);
});

test('la brújula prioriza norte geográfico y rechaza lecturas sin calibrar', () => {
  assert.equal(compassHeading({ trueHeading: 350, magHeading: 340, accuracy: 3 }), 350);
  assert.equal(compassHeading({ trueHeading: -1, magHeading: 340, accuracy: 2 }), 340);
  assert.equal(compassHeading({ trueHeading: 350, magHeading: 340, accuracy: 0 }), null);
  assert.equal(compassHeading({ trueHeading: NaN, magHeading: -1, accuracy: 3 }), null);
});
