import assert from 'node:assert/strict';
import test from 'node:test';

import { getTripMapPadding } from '../src/features/rides/presentation/tripMapLayout.ts';

for (const [width, height, bottom] of [[320, 568, 443], [390, 844, 659], [844, 390, 700], [320, 240, 500]]) {
  test(`trip camera keeps a visible route at ${width}x${height} with a ${bottom}px sheet`, () => {
    const padding = getTripMapPadding(width, height, 48, bottom, 96, 88);
    assert.ok(height - padding.top - padding.bottom >= 64);
    assert.ok(width - padding.left - padding.right >= width / 2);
    assert.ok(Object.values(padding).every(value => Number.isFinite(value) && value >= 0));
    if (bottom + 48 + 64 <= height) assert.ok(padding.bottom >= bottom);
  });
}

test('roomy trip maps preserve the requested tooltip margins', () => {
  assert.deepEqual(getTripMapPadding(1000, 1200, 48, 400, 96, 88), {
    top: 144, bottom: 496, left: 88, right: 88,
  });
});

test('tiny layouts and negative overlay measurements never create negative padding', () => {
  const padding = getTripMapPadding(80, 80, -5, -10, 96, 88);
  assert.ok(80 - padding.top - padding.bottom >= 40);
  assert.ok(Object.values(padding).every(value => value >= 0));
});

for (const [width, height] of [[320, 640], [390, 844], [768, 1024]]) {
  test(`compact trip framing enlarges the route without covering it with the sheet at ${width}x${height}`, () => {
    const sheet = Math.round(height * 0.64);
    const previous = getTripMapPadding(width, height, 48, sheet, 96, 50);
    const current = getTripMapPadding(width, height, 48, sheet);
    assert.ok(current.top >= 48 && current.bottom >= sheet);
    const routeHeight = height - current.top - current.bottom;
    assert.ok(routeHeight > height - previous.top - previous.bottom);
    assert.ok(width - current.left - current.right >= width - previous.left - previous.right);
    assert.ok(routeHeight >= 64);
  });
}

test('fractional layout measurements produce integer native edge padding', () => {
  const padding = getTripMapPadding(393.14, 851.33, 48.2, 545.71);
  assert.ok(Object.values(padding).every(Number.isInteger));
  assert.ok(851.33 - padding.top - padding.bottom >= 64);
});
