import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Resolve the `@/` alias to the TypeScript sources (node strips the types).
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return next(specifier, context);
  },
});
const { stepFare, MIN_STEPPED_FARE } = await import('../src/features/booking/domain/fareStep.ts');
const {
  formatArrivalTime,
  formatRouteDistance,
  formatRouteDuration,
  routeMidpoint,
} = await import('../src/features/booking/domain/routeEstimate.ts');
const { getLabelAwareFitCoordinates } = await import(
  '../src/features/rides/presentation/routeTooltipLayout.ts'
);
hooks.deregister();

test('the fare buttons move by whole bolivianos and never reach zero', () => {
  assert.equal(stepFare('25', 1), '26');
  assert.equal(stepFare('25,5', -1), '24.5');
  assert.equal(stepFare('1', -1), String(MIN_STEPPED_FARE));
  assert.equal(stepFare('', 1), '1');
  assert.equal(stepFare('abc', -1), '1');
});

test('the estimate sits halfway along the road, not along the straight line', () => {
  // An L-shaped route: 3 equal legs east, then 1 leg north.
  const route = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.03 },
    { latitude: 0.01, longitude: 0.03 },
  ];
  const middle = routeMidpoint(route);
  assert.ok(Math.abs(middle.latitude) < 1e-9);
  assert.ok(Math.abs(middle.longitude - 0.02) < 1e-4);
  assert.equal(routeMidpoint([]), null);
  assert.deepEqual(routeMidpoint([route[0]]), route[0]);
});

test('distance, duration and arrival read naturally in Spanish', () => {
  assert.equal(formatRouteDistance(850.4), '850 m');
  assert.equal(formatRouteDistance(4230), '4,2 km');
  assert.equal(formatRouteDuration(20), '1 min');
  assert.equal(formatRouteDuration(720), '12 min');
  assert.equal(formatRouteDuration(3600), '1 h');
  assert.equal(formatRouteDuration(3900), '1 h 05 min');
  assert.equal(formatArrivalTime(new Date(2026, 8, 27, 14, 20), 720), '14:32');
  assert.equal(formatArrivalTime(new Date(2026, 8, 27, 23, 55), 600), '00:05');
});

test('the camera leaves room above the route for the estimate bubble', () => {
  const route = [
    { latitude: -16.5, longitude: -68.15 },
    { latitude: -16.5, longitude: -68.1 },
  ];
  const padding = { top: 16, bottom: 16, left: 16, right: 16 };
  const plain = getLabelAwareFitCoordinates(route, [], 360, 400, padding);
  const withBubble = getLabelAwareFitCoordinates(route, [], 360, 400, padding, [
    { coordinate: { latitude: -16.5, longitude: -68.125 }, size: { width: 150, height: 70 } },
  ]);
  const top = (points) => Math.max(...points.map((point) => point.latitude));
  assert.equal(top(plain), -16.5);
  assert.ok(top(withBubble) > -16.5, 'the bubble top is framed');
});
