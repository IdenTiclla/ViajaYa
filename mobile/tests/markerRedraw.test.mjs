import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleMarkerRedraw } from '../src/features/rides/presentation/routeTooltipLayout.ts';

function frames() {
  let next = 0;
  const pendingItems = new Map();
  return {
    request(callback) { const id = ++next; pendingItems.set(id, callback); return id; },
    cancel(id) { pendingItems.delete(id); },
    advance() {
      const currentItems = [...pendingItems.values()];
      pendingItems.clear();
      currentItems.forEach((callback) => callback());
    },
    count: () => pendingItems.size,
  };
}

test('waits two frames before requesting the marker capture', () => {
  const clock = frames();
  let layout = 'incompleto';
  const captures = [];
  scheduleMarkerRedraw(() => captures.push(layout), clock.request, clock.cancel);
  assert.deepEqual(captures, []);
  clock.advance();
  assert.deepEqual(captures, []);
  layout = 'pin y tooltip completos';
  clock.advance();
  assert.deepEqual(captures, ['pin y tooltip completos']);
  assert.equal(clock.count(), 0);
});

for (const elapsed of [0, 1]) {
  test(`unmounting after ${elapsed} frames cancels the pending redraw`, () => {
    const clock = frames();
    const cancel = scheduleMarkerRedraw(
      () => assert.fail('Must not touch an unmounted marker'), clock.request, clock.cancel,
    );
    if (elapsed) clock.advance();
    cancel();
    clock.advance();
    clock.advance();
    assert.equal(clock.count(), 0);
  });
}

test('a new label replaces the previous redraw without going back to the screen', () => {
  const clock = frames();
  const captures = [];
  const cancel = scheduleMarkerRedraw(
    () => captures.push('anterior'), clock.request, clock.cancel,
  );
  clock.advance();
  cancel();
  scheduleMarkerRedraw(() => captures.push('nueva'), clock.request, clock.cancel);
  clock.advance();
  clock.advance();
  assert.deepEqual(captures, ['nueva']);
});
