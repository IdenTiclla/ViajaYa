import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-location') return { url: 'prueba:ubicacion', shortCircuit: true };
    if (specifier === '../domain/locationHeading') return {
      url: new URL('../src/features/home/domain/locationHeading.ts', import.meta.url).href,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== 'prueba:ubicacion') return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export const PermissionStatus = { GRANTED: 'granted' }, Accuracy = { High: 4, Balanced: 3 };
      export const status = {};
      export function restart() {
        Object.assign(status, { permission: 'granted', late: false, noCompass: false,
          servicesEnabled: true, requestPermission: 0, pendingPermission: null, initial: null, initialQueries: 0,
          canAskAgain: true, subscriptions: 0, gpsRemovals: 0, compassRemovals: 0, pending: [], gps: null, compass: null });
      }
      export async function getForegroundPermissionsAsync() {
        return status.pendingPermission ?? { status: status.permission, canAskAgain: status.canAskAgain };
      }
      export async function requestForegroundPermissionsAsync() { status.requestPermission++; return { status: status.permission }; }
      export async function hasServicesEnabledAsync() { return status.servicesEnabled; }
      export function getCurrentPositionAsync(options) {
        status.initialQueries++; status.initialOptions = options;
        return status.initial ?? Promise.reject(new Error('Sin posición initial'));
      }
      export function watchPositionAsync(options, callback, error) {
        status.subscriptions++; status.options = options; status.gps = callback; status.errorGps = error;
        const sub = { remove() { status.gpsRemovals++; } };
        return status.late ? new Promise(resolve => status.pending.push(() => resolve(sub))) : Promise.resolve(sub);
      }
      export function watchHeadingAsync(callback, error) {
        status.subscriptions++; status.compass = callback; status.errorBrujula = error;
        if (status.noCompass) return Promise.reject(new Error('Sin sensor'));
        const sub = { remove() { status.compassRemovals++; } };
        return status.late ? new Promise(resolve => status.pending.push(() => resolve(sub))) : Promise.resolve(sub);
      }
    ` };
  },
});
const { watchLocation, checkLocationAvailability } = await import('../src/features/home/data/watchLocation.ts');
const { status, restart } = await import('expo-location');
hooks.deregister();

function read(timestamp, changes = {}) {
  return { timestamp, coords: {
    latitude: -16.5, longitude: -68.15, heading: 0, speed: 0, accuracy: 3, ...changes,
  } };
}

test('updates position and orientation independently and prioritizes heading when moving', async (t) => {
  restart();
  let currentTime = 10000;
  t.mock.method(Date, 'now', () => currentTime);
  const events = [];
  const sub = await watchLocation((coordinates, headingValue) => events.push({ coordinates, heading: headingValue }));
  status.compass({ trueHeading: 30, magHeading: 20, accuracy: 3 });
  assert.equal(events.length, 0, 'The compass does not invent a position');
  status.gps(read(currentTime));
  assert.equal(events.at(-1).heading, 30);
  const sampleCoordinates = events.at(-1).coordinates;
  currentTime += 200;
  status.compass({ trueHeading: 90, magHeading: 80, accuracy: 3 });
  assert.equal(events.at(-1).heading, 90);
  assert.equal(events.at(-1).coordinates, sampleCoordinates, 'Rotating the phone does not move the camera');
  currentTime += 1000;
  status.gps(read(currentTime, { latitude: -16.4999, heading: 0, speed: 10 }));
  assert.equal(events.at(-1).heading, 0);
  assert.equal(events.at(-1).coordinates.latitude, -16.4999);
  currentTime += 200;
  status.compass({ trueHeading: 180, magHeading: 170, accuracy: 3 });
  assert.equal(events.at(-1).heading, 0, 'Moving the phone does not replace the driving heading');
  currentTime += 1000;
  status.gps(read(currentTime, { latitude: -16.4999 }));
  assert.equal(events.at(-1).heading, 180, 'When stopped it responds to the compass again');
  const count = events.length;
  status.gps(read(currentTime - 5000, { longitude: -70 }));
  assert.equal(events.length, count, 'Ignora un GPS atrasado');
  sub.remove();
  assert.equal(status.gpsRemovals, 1);
  assert.equal(status.compassRemovals, 1);
});

test('the first valid heading appears even if it arrives right after the GPS', async (t) => {
  restart();
  t.mock.method(Date, 'now', () => 10000);
  const headings = [];
  const sub = await watchLocation((_, headingValue) => headings.push(headingValue));
  status.gps(read(10000));
  status.compass({ trueHeading: 270, magHeading: 260, accuracy: 3 });
  assert.deepEqual(headings, [null, 270]);
  sub.remove();
});

test('cancelling before the native subscription removes both sensors and discards their late callbacks', async () => {
  restart(); status.late = true;
  const sub = await watchLocation(() => assert.fail('Callback of a cancelled subscription'));
  sub.remove(); sub.remove();
  status.pending.forEach(resolve => resolve());
  await Promise.resolve();
  status.gps(read(Date.now()));
  status.compass({ trueHeading: 90, magHeading: 80, accuracy: 3 });
  assert.equal(status.gpsRemovals, 1);
  assert.equal(status.compassRemovals, 1);
});

test('without a compass it keeps receiving GPS and a location error cancels both sensors', async () => {
  restart(); status.noCompass = true;
  const events = []; let errors = 0;
  const sub = await watchLocation((coordinates) => events.push(coordinates), () => errors++);
  await Promise.resolve();
  status.gps(read(Date.now(), { heading: 90, speed: 10 }));
  assert.equal(events.length, 1);
  status.errorGps('GPS apagado');
  status.gps(read(Date.now() + 1000));
  assert.equal(events.length, 1);
  assert.equal(errors, 1);
  assert.equal(status.gpsRemovals, 1);
  sub.remove();
});

test('a denied permission starts none of the sensors', async () => {
  restart(); status.permission = 'denied';
  assert.equal(await watchLocation(() => assert.fail()), null);
  assert.equal(status.subscriptions, 0);
});

test('gets a first position without waiting for the watcher and does not query again on every reading', async () => {
  restart();
  status.initial = Promise.resolve(read(Date.now(), { latitude: -17.39, longitude: -66.16 }));
  const events = [];
  const sub = await watchLocation((coordinates) => events.push(coordinates));
  await Promise.resolve();
  assert.deepEqual(events[0], { latitude: -17.39, longitude: -66.16 });
  assert.equal(status.requestPermission, 0, 'A granted permission does not open another dialog');
  assert.equal(status.options.mayShowUserSettingsDialog, false);
  assert.equal(status.initialOptions.accuracy, 3, 'Startup can also use the network');
  for (let i = 1; i <= 10; i++) status.gps(read(Date.now() + i));
  assert.equal(status.initialQueries, 1, 'No polling or subscriptions on every render');
  assert.equal(status.subscriptions, 2, 'One GPS and one compass');
  sub.remove();
});

test('discards the old initial location and does not displace a more recent GPS fix', async () => {
  restart();
  let release;
  status.initial = new Promise(resolve => { release = resolve; });
  const events = [];
  const sub = await watchLocation((coordinates) => events.push(coordinates));
  status.gps(read(Date.now() - 60_000));
  assert.equal(events.length, 0, 'An old location does not decide where to open the map');
  status.gps(read(Date.now(), { latitude: -17.39 }));
  release(read(Date.now() - 1000, { latitude: -16.5 }));
  await Promise.resolve();
  assert.equal(events.length, 1);
  assert.equal(events[0].latitude, -17.39);
  sub.remove();
});

test('cancelling during the permission prevents activating sensors after leaving the screen', async () => {
  restart();
  let release;
  status.pendingPermission = new Promise(resolve => { release = resolve; });
  const cancellation = new AbortController();
  const start = watchLocation(() => assert.fail(), undefined, cancellation.signal);
  cancellation.abort();
  release({ status: 'granted', canAskAgain: true });
  assert.equal(await start, null);
  assert.equal(status.subscriptions, 0);
  assert.equal(status.initialQueries, 0);
});

test('location turned off is told apart from a denied permission without opening native dialogs', async () => {
  restart(); status.servicesEnabled = false;
  const errors = [];
  assert.equal(await watchLocation(() => assert.fail(), reason => errors.push(reason)), null);
  assert.deepEqual(errors, ['disabled']);
  assert.equal(await checkLocationAvailability(), 'disabled');
  assert.equal(status.subscriptions, 0);
  assert.equal(status.requestPermission, 0);
  status.servicesEnabled = true;
  assert.equal(await checkLocationAvailability(), 'granted');
  status.permission = 'denied';
  assert.equal(await checkLocationAvailability(), 'denied');
  assert.equal(status.requestPermission, 0);
});

test('a retry shares the pending initial acquisition and discards the cancelled consumer', async () => {
  restart();
  let release;
  status.initial = new Promise(resolve => { release = resolve; });
  const previous = await watchLocation(() => assert.fail('Consumidor cancelado'));
  previous.remove();
  const events = [];
  const current = await watchLocation((coordinates) => events.push(coordinates));
  assert.equal(status.initialQueries, 1);
  release(read(Date.now()));
  await Promise.resolve();
  assert.equal(events.length, 1);
  current.remove();
});
