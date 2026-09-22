import assert from 'node:assert/strict';
import test from 'node:test';

import { orderOffers } from '../src/features/rides/domain/offerComparison.ts';

const offer = (id, price, etaMin, createdAt = null) => ({ id, price, etaMin, createdAt });
const ids = offers => offers.map(item => item.id);

test('price comparison keeps equal fares stable instead of reordering tied drivers', () => {
  const offers = [offer('expensive', 40, 2), offer('first-tie', 25, 9), offer('second-tie', 25, 4)];
  assert.deepEqual(ids(orderOffers(offers, 'price')), ['first-tie', 'second-tie', 'expensive']);
});

test('arrival comparison puts missing estimates last and preserves known zero minutes', () => {
  const offers = [offer('unknown-a', 20, null), offer('later', 20, 8), offer('here', 25, 0),
    offer('soon', 30, 2), offer('unknown-b', 20, null)];
  assert.deepEqual(ids(orderOffers(offers, 'arrival')), ['here', 'soon', 'later', 'unknown-a', 'unknown-b']);
});

test('recent comparison handles unordered replies, missing dates and malformed timestamps', () => {
  const offers = [offer('unknown', 20, 5), offer('old', 20, 5, '2026-09-19T10:00:00Z'),
    offer('new', 20, 5, '2026-09-19T10:00:10Z'), offer('invalid', 20, 5, 'invalid')];
  assert.deepEqual(ids(orderOffers(offers, 'recent')), ['new', 'old', 'unknown', 'invalid']);
});

for (const order of ['recent', 'price', 'arrival']) {
  test(`${order} comparison leaves the React Query array and offer identities untouched`, () => {
    const offers = Object.freeze([Object.freeze(offer('a', 35, 9)), Object.freeze(offer('b', 25, 2))]);
    const sorted = orderOffers(offers, order);
    assert.notEqual(sorted, offers);
    assert.deepEqual(ids(offers), ['a', 'b']);
    assert.equal(sorted.find(item => item.id === 'a'), offers[0]);
    assert.deepEqual(orderOffers([], order), []);
  });
}
