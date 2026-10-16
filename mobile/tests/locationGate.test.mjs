import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

// Resolve the `@/` alias and extensionless relative imports to the TypeScript sources.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});
const gateState = await import('../src/features/location/domain/gateState.ts');
const gateCopy = await import('../src/features/location/domain/gateCopy.ts');
const fixState = await import('../src/features/location/domain/fixState.ts');
const storedFix = await import('../src/features/location/domain/storedFix.ts');
const { createLocationGateStore } = await import(
  '../src/features/location/application/createLocationGateStore.ts'
);
hooks.deregister();

const { resolveGateState, INITIAL_GATE_SESSION } = gateState;
const fresh = () => ({ ...INITIAL_GATE_SESSION });
const snap = (status, canAskAgain, servicesEnabled = true) => ({ status, canAskAgain, servicesEnabled });
const gateOf = (snapshot, asked, capability = 'capable', role = 'passenger', session = fresh()) =>
  resolveGateState(snapshot, asked, capability, role, session);

// ---------------------------------------------------------------- resolution table

test('the gate resolves every row of the permission table', () => {
  assert.equal(gateOf(null, false).gate.kind, 'checking');
  assert.equal(gateOf(snap('undetermined', true), false).gate.kind, 'primer');
  assert.equal(gateOf(snap('denied', true), false).gate.kind, 'primer');
  assert.equal(gateOf(snap('denied', true), true).gate.kind, 'denied');
  assert.equal(gateOf(snap('denied', false), false).gate.kind, 'blocked');
  assert.equal(gateOf(snap('denied', false), true).gate.kind, 'blocked');
  assert.equal(gateOf(snap('granted', true, false), true).gate.kind, 'services-off');
  assert.equal(gateOf(snap('granted', true, true), true).gate.kind, 'open');
});

test('Android sequence: primer, then denied, then blocked', () => {
  assert.equal(gateOf(snap('undetermined', true), false).gate.kind, 'primer');
  assert.equal(gateOf(snap('denied', true), true).gate.kind, 'denied');
  assert.equal(gateOf(snap('denied', false), true).gate.kind, 'blocked');
});

test('iOS sequence: the first denial is already blocked and never shows the denied screen', () => {
  assert.equal(gateOf(snap('undetermined', true), false).gate.kind, 'primer');
  assert.equal(gateOf(snap('denied', false), true).gate.kind, 'blocked');
});

test('while the gate is the entry intercept it carries no banner', () => {
  for (const snapshot of [snap('undetermined', true), snap('denied', false), snap('granted', true, false)]) {
    assert.equal(gateOf(snapshot, true).banner, null);
  }
});

// ---------------------------------------------------------------- session rules

test('«Ahora no» turns a blocking state into manual mode with the matching banner', () => {
  const session = { entryDone: true, dismissed: true };
  const cases = [
    [snap('undetermined', true), 'permission-denied'],
    [snap('denied', true), 'permission-denied'],
    [snap('denied', false), 'permission-blocked'],
    [snap('granted', true, false), 'services-off'],
  ];
  for (const [snapshot, banner] of cases) {
    const result = gateOf(snapshot, true, 'capable', 'passenger', session);
    assert.deepEqual(result.gate, { kind: 'manual', reason: 'dismissed' });
    assert.equal(result.banner, banner);
  }
});

test('the driver cannot dismiss the gate', () => {
  const result = gateOf(snap('denied', false), true, 'capable', 'driver', { entryDone: false, dismissed: true });
  assert.equal(result.gate.kind, 'blocked');
});

test('a usable location wins over the dismissal', () => {
  const result = gateOf(snap('granted', true, true), true, 'capable', 'passenger', { entryDone: true, dismissed: true });
  assert.deepEqual(result, { gate: { kind: 'open' }, banner: null });
});

test('after the entry, losing the location shows a banner and never a full screen', () => {
  const session = { entryDone: true, dismissed: false };
  const off = gateOf(snap('granted', true, false), true, 'capable', 'passenger', session);
  assert.deepEqual(off, { gate: { kind: 'open' }, banner: 'services-off' });
  const revoked = gateOf(snap('denied', false), true, 'capable', 'driver', session);
  assert.deepEqual(revoked, { gate: { kind: 'open' }, banner: 'permission-blocked' });
});

test('devices without location hardware never see the gate or the banner', () => {
  for (const snapshot of [null, snap('denied', false), snap('granted', true, false), snap('granted', true, true)]) {
    assert.deepEqual(gateOf(snapshot, false, 'none', 'passenger'), {
      gate: { kind: 'manual', reason: 'no-capability' }, banner: null,
    });
    assert.deepEqual(gateOf(snapshot, false, 'none', 'driver'), { gate: { kind: 'unsupported' }, banner: null });
  }
});

// ---------------------------------------------------------------- copy

test('every gate screen has copy for each role and platform', () => {
  for (const kind of ['primer', 'denied', 'blocked', 'services-off']) {
    for (const role of ['passenger', 'driver']) {
      for (const platform of ['android', 'ios']) {
        const content = gateCopy.gateContent(kind, role, platform);
        assert.ok(content.title.length > 0 && content.body.length > 0 && content.cta.length > 0);
        // Only the passenger can leave the gate.
        assert.equal(content.secondary, role === 'passenger' ? 'Ahora no' : undefined);
        if (kind === 'blocked') assert.equal(content.steps?.length, 3);
        if (kind === 'primer') assert.equal(content.benefits?.length, 3);
      }
    }
  }
});

test('the three banner causes have their own copy and the GPS one names the fix', () => {
  assert.equal(gateCopy.bannerText('services-off'), 'No pudimos ubicarte. Toca para encender la ubicación.');
  const texts = ['services-off', 'permission-denied', 'permission-blocked'].map(gateCopy.bannerText);
  assert.equal(new Set(texts).size, 3);
});

test('copy guard: the old generic location failure never comes back', () => {
  const src = new URL('../src', import.meta.url).pathname;
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  })(src);
  const locationPath = /locationService|expo-location|features\/location|useWatchPosition|HomeScreen|PickOnMapScreen|DriverSearchMap|IncomingRequestsScreen/;
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (/No pudimos obtener tu ubicación/.test(text)) offenders.push(`${file}: No pudimos obtener tu ubicación`);
    if (locationPath.test(file) || locationPath.test(text)) {
      for (const phrase of ['Inténtalo de nuevo', 'Intenta de nuevo']) {
        if (text.includes(phrase)) offenders.push(`${file}: ${phrase}`);
      }
    }
    // The banner sentence lives only in gateCopy.ts.
    if (text.includes('No pudimos ubicarte') && !file.endsWith('features/location/domain/gateCopy.ts')) {
      if (!/^\s*(\*|\/\/)/m.test(text.split('No pudimos ubicarte')[0].split('\n').pop() ?? '')) {
        offenders.push(`${file}: banner sentence outside gateCopy.ts`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------- fix phases

const A = { latitude: -16.5, longitude: -68.15 };
const B = { latitude: -16.51, longitude: -68.16 };

test('the search starts locating, becomes weak only while empty, and a late fix recovers', () => {
  let state = fixState.INITIAL_FIX;
  assert.equal(state.phase, 'locating');
  state = fixState.reduceFix(state, { type: 'slow' });
  assert.equal(state.phase, 'weak');
  state = fixState.reduceFix(state, { type: 'position', coordinates: A, isEstimated: false, accuracy: 12 });
  assert.deepEqual(state, { phase: 'ready', coordinates: A, isEstimated: false, accuracy: 12 });
});

test('a stored fix shows as estimated and never replaces a fresh one', () => {
  let state = fixState.reduceFix(fixState.INITIAL_FIX, { type: 'cached', coordinates: A });
  assert.deepEqual([state.phase, state.isEstimated], ['ready', true]);
  state = fixState.reduceFix(state, { type: 'slow' });
  assert.equal(state.phase, 'ready'); // a position on screen is never downgraded to weak
  state = fixState.reduceFix(state, { type: 'position', coordinates: B, isEstimated: false, accuracy: 8 });
  assert.equal(state.isEstimated, false);
  const kept = fixState.reduceFix(state, { type: 'cached', coordinates: A });
  assert.deepEqual(kept.coordinates, B);
  const provisional = fixState.reduceFix(state, { type: 'position', coordinates: A, isEstimated: true, accuracy: null });
  assert.deepEqual(provisional.coordinates, B);
});

test('a new search keeps the map position as provisional', () => {
  const ready = fixState.reduceFix(fixState.INITIAL_FIX, { type: 'position', coordinates: A, isEstimated: false, accuracy: 5 });
  const restarted = fixState.reduceFix(ready, { type: 'reset' });
  assert.deepEqual([restarted.coordinates, restarted.isEstimated, restarted.phase], [A, true, 'ready']);
  assert.deepEqual(fixState.reduceFix(fixState.INITIAL_FIX, { type: 'reset' }), fixState.INITIAL_FIX);
});

// ---------------------------------------------------------------- stored fix

test('the stored fix rejects malformed, impossible, stale and future payloads', () => {
  const now = 1_000_000_000_000;
  const good = storedFix.serializeFix(A, now - 1000);
  assert.deepEqual(storedFix.parseStoredFix(good, now)?.coordinates, A);
  assert.equal(storedFix.parseStoredFix(null, now), null);
  assert.equal(storedFix.parseStoredFix('not json', now), null);
  assert.equal(storedFix.parseStoredFix('{"latitude":"1","longitude":2,"savedAt":1}', now), null);
  assert.equal(storedFix.parseStoredFix(JSON.stringify({ latitude: NaN, longitude: 2, savedAt: now }), now), null);
  assert.equal(storedFix.parseStoredFix(JSON.stringify({ latitude: 91, longitude: 2, savedAt: now }), now), null);
  assert.equal(storedFix.parseStoredFix(JSON.stringify({ latitude: 1, longitude: 181, savedAt: now }), now), null);
  assert.equal(storedFix.parseStoredFix(JSON.stringify({ latitude: 1, longitude: 2 }), now), null);
  assert.equal(storedFix.parseStoredFix(storedFix.serializeFix(A, now - 25 * 3600_000), now), null);
  assert.equal(storedFix.parseStoredFix(storedFix.serializeFix(A, now + 10 * 60_000), now), null);
  // Manual mode only needs a map center, whatever its age.
  assert.deepEqual(
    storedFix.parseStoredFix(storedFix.serializeFix(A, now - 90 * 24 * 3600_000), now, Infinity)?.coordinates,
    A,
  );
});

// ---------------------------------------------------------------- store

function fakeDeps(overrides = {}) {
  const calls = { request: 0, appSettings: 0, locationSettings: 0, saveAsked: 0 };
  let snapshot = snap('undetermined', true);
  let asked = false;
  const deps = {
    calls,
    set(next) { snapshot = next; },
    readSnapshot: async () => snapshot,
    readServicesEnabled: async () => snapshot.servicesEnabled,
    requestPermission: async () => { calls.request += 1; await new Promise((r) => setTimeout(r, 20)); },
    readAsked: async () => asked,
    saveAsked: async () => { calls.saveAsked += 1; asked = true; },
    readCapability: () => 'capable',
    openAppSettings: async () => { calls.appSettings += 1; },
    openLocationSettings: async () => { calls.locationSettings += 1; },
    ...overrides,
  };
  return deps;
}

test('opening the gate reads silently and never asks', async () => {
  const deps = fakeDeps();
  const store = createLocationGateStore(deps);
  await store.getState().init();
  assert.equal(store.getState().loaded, true);
  assert.equal(deps.calls.request, 0);
  assert.equal(store.getState().snapshot.status, 'undetermined');
});

test('two screens asking at once open a single system dialog', async () => {
  const deps = fakeDeps();
  const store = createLocationGateStore(deps);
  await store.getState().init();
  deps.set(snap('granted', true));
  await Promise.all([store.getState().requestPermission(), store.getState().requestPermission()]);
  assert.equal(deps.calls.request, 1);
  assert.equal(deps.calls.saveAsked, 1);
  assert.equal(store.getState().busy, false);
  assert.equal(store.getState().askedThisInstall, true);
  assert.equal(store.getState().snapshot.status, 'granted');
});

test('the first usable read marks the entry as done', async () => {
  const deps = fakeDeps();
  const store = createLocationGateStore(deps);
  deps.set(snap('granted', true, true));
  await store.getState().init();
  assert.equal(store.getState().session.entryDone, true);
  // Turning the GPS off later is a mid-session loss: banner, not a gate screen.
  deps.set(snap('granted', true, false));
  await store.getState().pollServices();
  const state = store.getState();
  const result = resolveGateState(state.snapshot, state.askedThisInstall, state.capability, 'passenger', state.session);
  assert.deepEqual(result, { gate: { kind: 'open' }, banner: 'services-off' });
});

test('the services poll only re-reads when the location switch changed', async () => {
  let reads = 0;
  const deps = fakeDeps();
  const original = deps.readSnapshot;
  deps.readSnapshot = async () => { reads += 1; return original(); };
  const store = createLocationGateStore(deps);
  deps.set(snap('granted', true, true));
  await store.getState().init();
  const afterInit = reads;
  await store.getState().pollServices();
  await store.getState().pollServices();
  assert.equal(reads, afterInit);
  deps.set(snap('granted', true, false));
  await store.getState().pollServices();
  assert.equal(reads, afterInit + 1);
  assert.equal(store.getState().snapshot.servicesEnabled, false);
});

test('the poll does nothing without the permission', async () => {
  const deps = fakeDeps();
  let polled = 0;
  deps.readServicesEnabled = async () => { polled += 1; return true; };
  const store = createLocationGateStore(deps);
  await store.getState().init();
  await store.getState().pollServices();
  assert.equal(polled, 0);
});

test('«Ahora no» is remembered for the session only and each store starts clean', async () => {
  const deps = fakeDeps();
  const store = createLocationGateStore(deps);
  await store.getState().init();
  store.getState().dismiss();
  assert.deepEqual(store.getState().session, { entryDone: true, dismissed: true });
  const coldStart = createLocationGateStore(fakeDeps());
  assert.deepEqual(coldStart.getState().session, { entryDone: false, dismissed: false });
});

test('a failing dialog or settings call still lands on the real state', async () => {
  const deps = fakeDeps({
    requestPermission: async () => { throw new Error('native failure'); },
    openLocationSettings: async () => { throw new Error('no dialog'); },
  });
  const store = createLocationGateStore(deps);
  await store.getState().init();
  await store.getState().requestPermission();
  assert.equal(store.getState().busy, false);
  deps.set(snap('granted', true, false));
  await store.getState().openLocationSettings();
  assert.equal(store.getState().busy, false);
  assert.equal(store.getState().snapshot.servicesEnabled, false);
});

test('`loaded` waits for the asked flag and the capability, even if a refresh finishes first', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const deps = fakeDeps({
    readAsked: async () => { await gate; return true; },
    readCapability: () => 'none',
  });
  const store = createLocationGateStore(deps);
  const init = store.getState().init();
  await store.getState().refresh();
  assert.equal(store.getState().loaded, false);
  release();
  await init;
  assert.equal(store.getState().loaded, true);
  assert.equal(store.getState().askedThisInstall, true);
  assert.equal(store.getState().capability, 'none');
});

test('a failing first read lands on the primer instead of a gate stuck checking', async () => {
  const deps = fakeDeps({ readSnapshot: async () => { throw new Error('native failure'); } });
  const store = createLocationGateStore(deps);
  await store.getState().init();
  const { loaded, snapshot, askedThisInstall, capability, session } = store.getState();
  assert.equal(loaded, true);
  assert.equal(gateOf(snapshot, askedThisInstall, capability, 'driver', session).gate.kind, 'primer');
});

test('a failing refresh keeps the last good snapshot', async () => {
  let fail = false;
  const deps = fakeDeps({
    readSnapshot: async () => {
      if (fail) throw new Error('native failure');
      return snap('granted', true);
    },
  });
  const store = createLocationGateStore(deps);
  await store.getState().init();
  fail = true;
  await store.getState().refresh();
  assert.equal(store.getState().snapshot.status, 'granted');
});

test('switching role starts a fresh session: a passenger dismissal does not carry to the driver', async () => {
  const deps = fakeDeps();
  const store = createLocationGateStore(deps);
  await store.getState().init();
  store.getState().enterRole('passenger');
  store.getState().dismiss();
  assert.deepEqual(store.getState().session, { entryDone: true, dismissed: true });
  store.getState().enterRole('passenger');
  assert.equal(store.getState().session.dismissed, true);
  store.getState().enterRole('driver');
  assert.deepEqual(store.getState().session, { entryDone: false, dismissed: false });
  assert.equal(store.getState().sessionRole, 'driver');
});

test('switching role with a usable location keeps the entry as done', async () => {
  const deps = fakeDeps();
  deps.set(snap('granted', true));
  const store = createLocationGateStore(deps);
  await store.getState().init();
  store.getState().enterRole('passenger');
  store.getState().enterRole('driver');
  assert.deepEqual(store.getState().session, { entryDone: true, dismissed: false });
});
