import assert from 'node:assert/strict';
import test from 'node:test';

import { compassHeading, movementHeading } from '../src/features/home/domain/locationHeading.ts';

const sample = (changes = {}) => ({
  coordinates: { latitude: -16.5, longitude: -68.15 },
  heading: null, speed: null, precision: 3, timestamp: 10000, ...changes,
});

test('GPS orients while moving and discards the zero heading kept when stopping', () => {
  assert.equal(movementHeading(null, sample({ heading: 90, speed: 8 })), 90);
  assert.equal(movementHeading(null, sample({ heading: 0, speed: 0 })), null);
  assert.equal(movementHeading(null, sample({ heading: 0, speed: 10 })), 0);
});

test('without a GPS heading it computes the direction between sufficiently separated positions', () => {
  const previous = sample();
  const north = sample({ coordinates: { latitude: -16.4998, longitude: -68.15 }, timestamp: 11000 });
  const east = sample({ coordinates: { latitude: -16.5, longitude: -68.1498 }, timestamp: 11000 });
  assert.equal(movementHeading(previous, north), 0);
  assert.ok(Math.abs(movementHeading(previous, east) - 90) < 0.1);
  assert.equal(movementHeading(previous, { ...north, precision: 100 }), null);
  assert.equal(movementHeading(previous, { ...north, timestamp: 9000 }), null);
  assert.equal(movementHeading(previous, { ...north, timestamp: 40000 }), null);
});

test('the compass prioritizes geographic north and rejects uncalibrated readings', () => {
  assert.equal(compassHeading({ trueHeading: 350, magHeading: 340, accuracy: 3 }), 350);
  assert.equal(compassHeading({ trueHeading: -1, magHeading: 340, accuracy: 2 }), 340);
  assert.equal(compassHeading({ trueHeading: 350, magHeading: 340, accuracy: 0 }), null);
  assert.equal(compassHeading({ trueHeading: NaN, magHeading: -1, accuracy: 3 }), null);
});
