import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePinAnchor,
  chooseTooltipPlacement,
  projectRouteRelativeToPin,
  ROUTE_PIN_SIZE,
  placeTooltipClearOfRoute,
} from '../src/features/rides/presentation/routeTooltipLayout.ts';

const south = { latitude: -16.51, longitude: -68.15 };
const north = { latitude: -16.50, longitude: -68.15 };

test('labels stay off the vertical route in both directions', () => {
  assert.equal(chooseTooltipPlacement('A', south, [south, north]), 'below');
  assert.equal(chooseTooltipPlacement('B', north, [south, north]), 'above');
  assert.equal(chooseTooltipPlacement('A', north, [north, south]), 'above');
  assert.equal(chooseTooltipPlacement('B', south, [north, south]), 'below');
});

test('the nearby segment rules even if the route detours in the opposite direction', () => {
  const southDetour = { ...south, latitude: south.latitude - 0.001 };
  const northDetour = { ...north, latitude: north.latitude + 0.001 };
  const route = [south, southDetour, northDetour, north];
  assert.equal(chooseTooltipPlacement('A', south, route), 'above');
  assert.equal(chooseTooltipPlacement('B', north, route), 'below');
});

test('rotating the map flips the labels\' free side', () => {
  assert.equal(chooseTooltipPlacement('A', south, [south, north], 180), 'above');
  assert.equal(chooseTooltipPlacement('B', north, [south, north], 180), 'below');
  const east = { ...south, longitude: south.longitude + 0.01 };
  assert.equal(chooseTooltipPlacement('A', south, [south, east], 90), 'below');
  assert.equal(chooseTooltipPlacement('A', south, [south, east], 270), 'above');
});

test('duplicated points and small street snaps do not flip the label', () => {
  const snap = { ...south, latitude: south.latitude - 0.000001 };
  assert.equal(chooseTooltipPlacement('A', south, [south, south, snap, north]), 'below');
});

test('a horizontal route separates the labels above and below', () => {
  const east = { ...south, longitude: south.longitude + 0.01 };
  assert.equal(chooseTooltipPlacement('A', south, [south, east]), 'above');
  assert.equal(chooseTooltipPlacement('B', east, [south, east]), 'below');
});

test('without a route or with coincident points it keeps valid placements', () => {
  assert.equal(chooseTooltipPlacement('A', south, []), 'above');
  assert.equal(chooseTooltipPlacement('B', south, [south, south]), 'below');
});

test('the pin center does not move when the label grows or shows Editar', () => {
  for (const blockHeight of [ROUTE_PIN_SIZE, 44, 62, 92]) {
    const aboveAnchor = computePinAnchor(blockHeight, 'above');
    const belowAnchor = computePinAnchor(blockHeight, 'below');
    // The center stays half a diameter from the edge, independent of the tooltip.
    assert.ok(Math.abs(blockHeight - aboveAnchor.y * blockHeight - ROUTE_PIN_SIZE / 2) < 0.000001);
    assert.ok(Math.abs(belowAnchor.y * blockHeight - ROUTE_PIN_SIZE / 2) < 0.000001);
    assert.equal(aboveAnchor.x, 0.5);
    assert.equal(belowAnchor.x, 0.5);
  }
  assert.deepEqual(computePinAnchor(0, 'above'), { x: 0.5, y: 0.5 });
});

const size = { width: 140, height: 32 };
const place = (route, preferred = 'above', label = size) =>
  placeTooltipClearOfRoute(route, label, preferred);

test('a curve coming back behind the text forces moving it further from the pin', () => {
  const result = place([
    { x: 0, y: 0 }, { x: 0, y: 90 }, { x: 120, y: 90 },
    { x: 120, y: -30 }, { x: -120, y: -30 },
  ]);
  assert.equal(result.placement, 'above');
  assert.equal(result.visible, true);
  assert.ok(result.separation > 28, 'Must clear the street crossing 30 from the pin');
});

test('detects a segment crossing even if both its vertices are outside the tooltip', () => {
  const result = place([{ x: -200, y: -30 }, { x: 200, y: -30 }]);
  assert.deepEqual(result, { placement: 'below', separation: 8, visible: true });
});

test('the real block size counts, including long labels and Editar', () => {
  const route = [{ x: 60, y: -30 }, { x: 100, y: -30 }];
  assert.equal(place(route, 'above', { width: 40, height: 20 }).placement, 'above');
  assert.equal(place(route, 'above', { width: 170, height: 70 }).placement, 'below');
  const horizontal = [{ x: -100, y: -65 }, { x: 100, y: -65 }];
  assert.equal(place(horizontal, 'above', { width: 140, height: 20 }).placement, 'above');
  assert.equal(place(horizontal, 'above', { width: 140, height: 70 }).placement, 'below');
});

test('the projection uses the zoom scale and the camera bearing', () => {
  const east = { ...south, longitude: south.longitude + 0.01 };
  const [near] = projectRouteRelativeToPin(south, [east], 0, 15);
  const [far] = projectRouteRelativeToPin(south, [east], 0, 14);
  const [turned] = projectRouteRelativeToPin(south, [east], 90, 15);
  assert.ok(Math.abs(near.x - far.x * 2) < 0.000001);
  assert.ok(Math.abs(turned.x) < 0.000001);
  assert.ok(Math.abs(turned.y + near.x) < 0.000001);
  assert.equal(Math.abs(near.y), 0);
});

test('recomputes collisions when zooming in and rotating the map', () => {
  const route = [
    { latitude: south.latitude + 0.001, longitude: south.longitude - 0.01 },
    { latitude: south.latitude + 0.001, longitude: south.longitude + 0.01 },
  ];
  const normal = projectRouteRelativeToPin(south, route, 0, 15);
  const near = projectRouteRelativeToPin(south, route, 0, 18);
  const rotated = projectRouteRelativeToPin(south, route, 180, 15);
  assert.equal(place(normal).placement, 'below');
  assert.equal(place(near).placement, 'above');
  assert.equal(place(rotated, 'below').placement, 'above');
});

test('without free room it neither covers the route nor creates an oversized bitmap', () => {
  const result = place([{ x: 0, y: -10000 }, { x: 0, y: 10000 }]);
  assert.deepEqual(result, { placement: 'above', separation: 8, visible: false });
});

test('empty routes, duplicates and streets outside the label keep the placement', () => {
  for (const route of [[], [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    [{ x: 100, y: -100 }, { x: 100, y: 100 }]]) {
    assert.deepEqual(place(route), { placement: 'above', separation: 8, visible: true });
  }
});
