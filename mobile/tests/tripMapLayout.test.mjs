import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTooltipFitCoordinates,
  getTripMapPadding,
} from '../src/features/rides/presentation/tripMapLayout.ts';

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

const mercatorX = (longitude) => longitude / 360;
const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) / (2 * Math.PI);

// Emulates fitToCoordinates: the bounding box fills the padded viewport.
function projectFit(points, width, height, padding) {
  const xs = points.map((p) => mercatorX(p.longitude));
  const ys = points.map((p) => mercatorY(p.latitude));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const scale = Math.min(innerW / (maxX - minX || Infinity), innerH / (maxY - minY || Infinity));
  const cx = padding.left + innerW / 2;
  const cy = padding.top + innerH / 2;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  return { scale, toScreen: (p) => ({
    x: cx + (mercatorX(p.longitude) - mx) * scale,
    y: cy - (mercatorY(p.latitude) - my) * scale,
  }) };
}

const cases = {
  'short horizontal trip': [{ latitude: -17.3935, longitude: -66.1570 }, { latitude: -17.3937, longitude: -66.1540 }],
  'short vertical trip': [{ latitude: -17.3900, longitude: -66.1570 }, { latitude: -17.3930, longitude: -66.1571 }],
  'long diagonal trip': [{ latitude: -17.36, longitude: -66.20 }, { latitude: -17.42, longitude: -66.12 }],
};
for (const [name, route] of Object.entries(cases)) {
  test(`pin labels stay inside the viewport on a ${name}`, () => {
    const [width, height] = [390, 360];
    const padding = { top: 72, bottom: 16, left: 16, right: 16 };
    const placements = name === 'short vertical trip' ? ['above', 'below'] : ['above', 'above'];
    const tooltips = [route[0], route[1]].map((coordinate, i) => ({
      coordinate, placement: placements[i], width: 178, height: 44, offset: 16,
    }));
    const points = getTooltipFitCoordinates(route, tooltips, width, height, padding);
    const { toScreen } = projectFit(points, width, height, padding);
    for (const tooltip of tooltips) {
      const pin = toScreen(tooltip.coordinate);
      const reach = tooltip.offset + tooltip.height;
      const top = tooltip.placement === 'above' ? pin.y - reach : pin.y;
      const bottom = tooltip.placement === 'above' ? pin.y : pin.y + reach;
      assert.ok(pin.x - tooltip.width / 2 >= padding.left - 0.5, `${name}: left edge ${pin.x - tooltip.width / 2}`);
      assert.ok(pin.x + tooltip.width / 2 <= width - padding.right + 0.5, `${name}: right edge`);
      assert.ok(top >= padding.top - 0.5, `${name}: top edge ${top}`);
      assert.ok(bottom <= height - padding.bottom + 0.5, `${name}: bottom edge`);
    }
  });
}

test('tooltip-aware fit keeps a closer zoom than a uniform tooltip margin', () => {
  const route = cases['short horizontal trip'];
  const [width, height] = [390, 360];
  const tight = { top: 72, bottom: 16, left: 16, right: 16 };
  const tooltips = route.map((coordinate) => ({ coordinate, placement: 'above', width: 178, height: 44, offset: 16 }));
  const smart = projectFit(getTooltipFitCoordinates(route, tooltips, width, height, tight), width, height, tight);
  const uniform = { top: 72 + 60, bottom: 16 + 60, left: 16 + 89, right: 16 + 89 };
  assert.ok(smart.scale >= projectFit(route, width, height, uniform).scale);
});

test('tooltip fit leaves degenerate input untouched', () => {
  const point = { latitude: -17.39, longitude: -66.15 };
  const tooltip = { coordinate: point, placement: 'above', width: 178, height: 44, offset: 16 };
  const padding = { top: 0, bottom: 0, left: 0, right: 0 };
  assert.deepEqual(getTooltipFitCoordinates([point, point], [tooltip], 390, 360, padding), [point, point]);
  assert.deepEqual(getTooltipFitCoordinates([point], [tooltip], 390, 360, padding), [point]);
});
