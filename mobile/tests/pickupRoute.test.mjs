import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approxDistanceMeters,
  isPickupPhase,
  isTightCluster,
  pickupRouteCell,
  streetLevelFrame,
  trimRouteToVehicle,
} from '../src/features/rides/domain/pickupRoute.ts';

const point = (latitude, longitude) => ({ latitude, longitude });

test('only accepted and arriving rides are in the pickup phase', () => {
  assert.equal(isPickupPhase('accepted'), true);
  assert.equal(isPickupPhase('arriving'), true);
  for (const status of ['searching', 'in_progress', 'completed', 'cancelled']) {
    assert.equal(isPickupPhase(status), false);
  }
});

test('GPS jitter keeps the same route cell; a few hundred meters change it', () => {
  const base = point(-17.3941, -66.1561);
  assert.deepEqual(pickupRouteCell(point(-17.39412, -66.15613)), pickupRouteCell(base));
  assert.notDeepEqual(pickupRouteCell(point(-17.3981, -66.1561)), pickupRouteCell(base));
});

test('distance approximation matches ~111 m per thousandth of latitude', () => {
  const meters = approxDistanceMeters(point(-17.39, -66.15), point(-17.391, -66.15));
  assert.ok(Math.abs(meters - 111.3) < 1);
});

test('the route starts at the vehicle and drops the covered part', () => {
  const route = [point(0, 0), point(0, 0.001), point(0, 0.002), point(0, 0.003)];
  const vehicle = point(0.00001, 0.00105);
  assert.deepEqual(trimRouteToVehicle(route, vehicle), [vehicle, point(0, 0.002), point(0, 0.003)]);
});

test('a vehicle past the last vertex still keeps a drawable segment to the pickup', () => {
  const route = [point(0, 0), point(0, 0.001)];
  const vehicle = point(0, 0.0011);
  assert.deepEqual(trimRouteToVehicle(route, vehicle), [vehicle, point(0, 0.001)]);
});

test('tight clusters are detected so the camera does not over-zoom', () => {
  assert.equal(isTightCluster([point(0, 0), point(0, 0.0002)], 40), true);
  assert.equal(isTightCluster([point(0, 0), point(0, 0.002)], 40), false);
});

test('the street-level frame surrounds the pickup symmetrically with the requested radius', () => {
  const center = point(-17.7866, -63.196);
  const [southWest, northEast] = streetLevelFrame(center, 90);
  assert.ok(southWest.latitude < center.latitude && northEast.latitude > center.latitude);
  assert.ok(southWest.longitude < center.longitude && northEast.longitude > center.longitude);
  assert.ok(Math.abs(approxDistanceMeters(center, point(northEast.latitude, center.longitude)) - 90) < 1);
  assert.ok(Math.abs(approxDistanceMeters(center, point(center.latitude, northEast.longitude)) - 90) < 1);
});
