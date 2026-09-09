import assert from 'node:assert/strict';
import test from 'node:test';

import { rumboDeBrujula, rumboDelMovimiento } from '../src/features/home/domain/orientacionUbicacion.ts';

const muestra = (cambios = {}) => ({
  coordinates: { latitude: -16.5, longitude: -68.15 },
  rumbo: null, velocidad: null, precision: 3, timestamp: 10000, ...cambios,
});

test('el GPS orienta en movimiento y descarta el rumbo cero retenido al detenerse', () => {
  assert.equal(rumboDelMovimiento(null, muestra({ rumbo: 90, velocidad: 8 })), 90);
  assert.equal(rumboDelMovimiento(null, muestra({ rumbo: 0, velocidad: 0 })), null);
  assert.equal(rumboDelMovimiento(null, muestra({ rumbo: 0, velocidad: 10 })), 0);
});

test('sin rumbo GPS calcula la dirección entre posiciones suficientemente separadas', () => {
  const anterior = muestra();
  const norte = muestra({ coordinates: { latitude: -16.4998, longitude: -68.15 }, timestamp: 11000 });
  const este = muestra({ coordinates: { latitude: -16.5, longitude: -68.1498 }, timestamp: 11000 });
  assert.equal(rumboDelMovimiento(anterior, norte), 0);
  assert.ok(Math.abs(rumboDelMovimiento(anterior, este) - 90) < 0.1);
  assert.equal(rumboDelMovimiento(anterior, { ...norte, precision: 100 }), null);
  assert.equal(rumboDelMovimiento(anterior, { ...norte, timestamp: 9000 }), null);
  assert.equal(rumboDelMovimiento(anterior, { ...norte, timestamp: 40000 }), null);
});

test('la brújula prioriza norte geográfico y rechaza lecturas sin calibrar', () => {
  assert.equal(rumboDeBrujula({ trueHeading: 350, magHeading: 340, accuracy: 3 }), 350);
  assert.equal(rumboDeBrujula({ trueHeading: -1, magHeading: 340, accuracy: 2 }), 340);
  assert.equal(rumboDeBrujula({ trueHeading: 350, magHeading: 340, accuracy: 0 }), null);
  assert.equal(rumboDeBrujula({ trueHeading: NaN, magHeading: -1, accuracy: 3 }), null);
});
