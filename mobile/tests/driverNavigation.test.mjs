import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
    source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext }, fileName: url }).outputText };
  return next(url, context);
}});
const { navigationTarget, wazeLinks, navigationErrorMessage } = await import('../src/features/navigation/domain/navigationTarget.ts');
const { runNavigationSession } = await import('../src/features/navigation/application/navigationSession.ts');
const { newerLocation, locationFreshness, canTrackRide } = await import('../src/features/tracking/domain/driverLocation.ts');
hooks.deregister();
const origin = { name: 'Recogida', coordinates: { latitude: -16.5, longitude: -68.13 } };
const destination = { name: 'Destino', coordinates: { latitude: -16.52, longitude: -68.1 } };
const ride = { id: 'r1', status: 'accepted', service: 'taxi', origin, destination, driver: { vehicleType: 'taxi' } };
for (const status of ['accepted', 'arriving', 'in_progress']) test(`navigation target and tracking follow ${status}`, () => {
  const target = navigationTarget({ ...ride, status });
  assert.equal(target.place, status === 'in_progress' ? destination : origin);
  assert.equal(canTrackRide({ status }), true);
  const links = wazeLinks(target);
  assert.ok(links.app.includes(`${target.place.coordinates.latitude},${target.place.coordinates.longitude}`));
  assert.ok(links.web.startsWith('https://waze.com/ul?'));
  assert.ok(!links.web.includes('r1'));
});
for (const status of ['searching', 'completed', 'cancelled']) test(`no navigation or GPS sharing in ${status}`, () => {
  assert.equal(navigationTarget({ ...ride, status }), null); assert.equal(canTrackRide({ status }), false);
});
test('motorcycle profile follows actual vehicle, including parcels', () => {
  assert.equal(navigationTarget({ ...ride, service: 'moto' }).motorcycle, true);
  assert.equal(navigationTarget({ ...ride, service: 'delivery', driver: { vehicleType: 'moto' } }).motorcycle, true);
  assert.equal(navigationTarget({ ...ride, service: 'moving', driver: { vehicleType: 'truck' } }).motorcycle, false);
  assert.equal(navigationTarget({ ...ride, origin: { ...origin, coordinates: { latitude: NaN, longitude: 1 } } }), null);
});
const gps = { rideId: 'r1', driverId: 'd1', capturedAt: '2026-09-19T12:00:00Z' };
test('reordered HTTP and WS samples cannot move the vehicle backwards', () => {
  assert.equal(newerLocation(gps, { ...gps, capturedAt: '2026-09-19T11:59:59Z' }), gps);
  assert.equal(newerLocation(gps, { ...gps }), gps);
  const next = { ...gps, capturedAt: '2026-09-19T12:00:05Z' };
  assert.equal(newerLocation(gps, next), next);
  assert.equal(newerLocation(gps, null), null);
});
test('stale GPS is labelled and expired GPS is hidden', () => {
  const time = Date.parse(gps.capturedAt);
  assert.equal(locationFreshness(null, time), 'waiting');
  assert.equal(locationFreshness(gps, time + 5_000), 'live');
  assert.equal(locationFreshness(gps, time + 25_000), 'stale');
  assert.equal(locationFreshness(gps, time + 121_000), 'unavailable');
  assert.equal(locationFreshness(gps, time - 20_000), 'unavailable');
});
function port(overrides = {}) {
  const calls = [];
  return { calls, requestPermission: async () => true, acceptTerms: async () => true,
    initialize: async () => { calls.push('init'); return 'ok'; },
    startLocationUpdates: () => { calls.push('subscribe-gps'); },
    waitForLocation: async () => { calls.push('gps'); },
    setDestination: async target => { calls.push(target.stage); return 'OK'; },
    start: async () => { calls.push('start'); }, stop: async () => { calls.push('stop'); }, ...overrides };
}
test('native guidance waits for GPS and always stops on leaving or Waze handoff', async () => {
  const p = port(), abort = new AbortController();
  await runNavigationSession(p, navigationTarget(ride), abort.signal, () => abort.abort());
  assert.deepEqual(p.calls, ['init', 'subscribe-gps', 'gps', 'pickup', 'start', 'stop']);
});
test('native GPS is explicitly activated before waiting for its first callback', async () => {
  let receiveLocation;
  const fix = new Promise(resolve => { receiveLocation = resolve; });
  const abort = new AbortController();
  const p = port({ startLocationUpdates: () => receiveLocation(), waitForLocation: () => fix });
  await runNavigationSession(p, navigationTarget(ride), abort.signal, () => abort.abort());
  assert.ok(p.calls.includes('start'));
});
test('a failed navigator initialization never starts the GPS provider or guidance', async () => {
  const p = port({ initialize: async () => 'notAuthorized' });
  await assert.rejects(runNavigationSession(p,navigationTarget(ride),new AbortController().signal,()=>assert.fail()),/notAuthorized/);
  assert.deepEqual(p.calls,['stop']);
});
test('a location subscription failure ends the session before calculating a route', async () => {
  const p = port({ startLocationUpdates: () => { throw new Error('LOCATION_DISABLED'); } });
  await assert.rejects(runNavigationSession(p,navigationTarget(ride),new AbortController().signal,()=>assert.fail()),/LOCATION_DISABLED/);
  assert.deepEqual(p.calls,['init','stop']);
});
for (const stage of ['requestPermission', 'acceptTerms', 'initialize', 'waitForLocation', 'setDestination', 'start']) {
  test(`cancellation during ${stage} prevents late guidance`, async () => {
    const abort = new AbortController();
    const p = port({ [stage]: async () => { abort.abort(); return stage === 'initialize' ? 'ok' : stage === 'setDestination' ? 'OK' : true; } });
    await assert.rejects(runNavigationSession(p, navigationTarget(ride), abort.signal, () => assert.fail('cancelled run became ready')));
    assert.equal(p.calls.at(-1), 'stop');
    assert.ok(!p.calls.includes('start'));
  });
}
for (const failure of ['NO_ROUTE_FOUND', 'QUOTA_CHECK_FAILED', 'LOCATION_UNKNOWN', 'NETWORK_ERROR']) {
  test(`routing failure ${failure} stops session and preserves its distinct message`, async () => {
    const p = port({ setDestination: async () => failure });
    await assert.rejects(runNavigationSession(p, navigationTarget(ride), new AbortController().signal, () => assert.fail()), new RegExp(failure));
    assert.deepEqual(p.calls, ['init', 'subscribe-gps', 'gps', 'stop']);
    assert.ok(navigationErrorMessage(failure).length > 20);
  });
}
