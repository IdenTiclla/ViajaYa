import assert from 'node:assert/strict';
import test from 'node:test';

import { orderRequests } from '../src/features/driver/domain/requestOrder.ts';

const ride = (id, { fare = 20, pickupKm = null, tripKm = 4, createdAt = null } = {}) =>
  ({ id, fare, createdAt, pickupKm, tripKm });
const distances = {
  pickupKm: (item) => item.pickupKm,
  tripKm: (item) => item.tripKm,
};
const ids = (rides) => rides.map((item) => item.id);

test('nearest puts the closest pickup first and requests without distance last', () => {
  const rides = [ride('far', { pickupKm: 4 }), ride('unknown'), ride('near', { pickupKm: 0.6 }),
    ride('mid', { pickupKm: 1.2 })];
  assert.deepEqual(ids(orderRequests(rides, 'nearest', distances)), ['near', 'mid', 'far', 'unknown']);
});

test('nearest without GPS keeps the incoming order', () => {
  const rides = [ride('a'), ride('b'), ride('c')];
  assert.deepEqual(ids(orderRequests(rides, 'nearest', distances)), ['a', 'b', 'c']);
});

test('best pays more per kilometre first, without letting tiny trips win on Bs/km alone', () => {
  const rides = [ride('cheap', { fare: 12, tripKm: 6 }), ride('rich', { fare: 30, tripKm: 5 }),
    ride('tiny', { fare: 8, tripKm: 0.2 }), ride('tie', { fare: 12, tripKm: 6 })];
  // tiny counts as 1 km: 8 Bs/km, above rich (6) and cheap/tie (2).
  assert.deepEqual(ids(orderRequests(rides, 'best', distances)), ['tiny', 'rich', 'cheap', 'tie']);
});

test('recent shows the newest first and leaves missing or malformed dates at the end', () => {
  const rides = [ride('none'), ride('old', { createdAt: '2026-10-02T10:00:00Z' }),
    ride('bad', { createdAt: 'nope' }), ride('new', { createdAt: '2026-10-02T10:00:30Z' })];
  assert.deepEqual(ids(orderRequests(rides, 'recent', distances)), ['new', 'old', 'none', 'bad']);
});

test('ordering never mutates the cached array', () => {
  const rides = Object.freeze([ride('b', { pickupKm: 2 }), ride('a', { pickupKm: 1 })]);
  const sorted = orderRequests(rides, 'nearest', distances);
  assert.notEqual(sorted, rides);
  assert.deepEqual(ids(rides), ['b', 'a']);
});
