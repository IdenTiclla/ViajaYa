import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Preserve hook state across renders and control network/native promises explicitly.
const state = { slots: [], cursor: 0 };
globalThis.__tripActionsTest = state;
const mocks = {
  react: `const state=globalThis.__tripActionsTest;
    export function useRef(value){const index=state.cursor++;return state.slots[index]??={current:value};}
    export function useState(value){const index=state.cursor++;if(!(index in state.slots))state.slots[index]=value;
      return [state.slots[index],next=>{state.slots[index]=next;}];}
    export const useLayoutEffect=effect=>effect();`,
  '@tanstack/react-query': 'export const useQueryClient=()=>globalThis.__tripActionsTest.client;',
  'react-native': `export const Linking={openURL:url=>globalThis.__tripActionsTest.openURL(url)};
    export const Share={share:input=>globalThis.__tripActionsTest.share(input)};`,
  '@/core/errors/apiError': 'export const getApiErrorMessage=error=>error.message;',
  '@/features/booking/domain/serviceCatalog': 'export const SERVICE_META={taxi:{label:"Taxi"},moto:{label:"Mototaxi"}};',
  './useRideMutations': `export const useUpdateRideStatus=()=>globalThis.__tripActionsTest.update;
    export const useCancelRide=()=>globalThis.__tripActionsTest.cancel;
    export const useMarkRiderOnTheWay=()=>globalThis.__tripActionsTest.notice;`,
  './useRides': `export const DRIVER_ACTIVE_RIDE_KEY=['driver-active-ride'];
    export const PASSENGER_ACTIVE_RIDE_KEY=['passenger-active-ride'];`,
};
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in mocks) return { url: `trip-actions:${specifier}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('trip-actions:')) return { format: 'module', shortCircuit: true, source: mocks[url.slice(13)] };
    if (url.endsWith('/useTripActions.ts')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext }, fileName: url,
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { useTripActions, useTripContact } = await import('../src/features/rides/application/useTripActions.ts');
loader.deregister();

const settle = () => new Promise(resolve => setImmediate(resolve));
const ride = (status = 'accepted', extra = {}) => ({
  id: 'trip-a', status, service: 'taxi', riderOnTheWayAt: null,
  origin: { name: 'Casa' }, destination: { name: 'Trabajo' }, ...extra,
});
function setup() {
  state.slots = [];
  const requests = [], invalidated = [];
  for (const name of ['update', 'cancel', 'notice']) {
    state[name] = {
      isPending: false, error: null, resets: 0,
      reset() { this.error = null; this.resets++; },
      mutateAsync: input => new Promise((resolve, reject) => requests.push({ name, input, resolve, reject })),
    };
  }
  state.client = { invalidateQueries: ({ queryKey }) => { invalidated.push(queryKey); return Promise.resolve(); } };
  state.openURL = async () => {};
  state.share = async () => {};
  return { requests, invalidated };
}
function render(value) { state.cursor = 0; return useTripActions(value); }
function contact(value, phone) { state.cursor = 0; return useTripContact(value, phone); }

for (const [stage, next] of [['accepted', 'arriving'], ['arriving', 'in_progress'], ['in_progress', 'completed']]) {
  test(`advance from ${stage} sends exactly one transition to ${next}`, async () => {
    const { requests, invalidated } = setup();
    const actions = render(ride(stage));
    actions.advance(stage); actions.advance(stage); actions.cancel(stage);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].input, { rideId: 'trip-a', status: next });
    requests[0].resolve(ride(next)); await settle();
    assert.deepEqual(invalidated, []);
  });
}
for (const stage of ['searching', 'accepted', 'arriving']) {
  test(`cancellation is available at ${stage} and blocks simultaneous pickup or advance`, async () => {
    const { requests } = setup(); const actions = render(ride(stage));
    actions.cancel(stage); actions.advance(stage); actions.notifyOnTheWay(); actions.cancel(stage);
    assert.deepEqual(requests.map(({ name, input }) => ({ name, input })), [{ name: 'cancel', input: 'trip-a' }]);
    requests[0].resolve(ride('cancelled')); await settle();
  });
}
test('missing, completed and cancelled trips cannot send any action', () => {
  const { requests } = setup();
  for (const value of [undefined, ride('completed'), ride('cancelled')]) {
    const actions = render(value);
    for (const stage of ['searching', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled']) {
      actions.advance(stage); actions.cancel(stage);
    }
    actions.notifyOnTheWay();
  }
  assert.deepEqual(requests, []);
});
test('a trip in progress cannot be cancelled or announce pickup', () => {
  const { requests } = setup(); const actions = render(ride('in_progress'));
  actions.cancel('in_progress'); actions.cancel('arriving'); actions.notifyOnTheWay();
  assert.deepEqual(requests, []);
});
for (const pending of ['update', 'cancel', 'notice']) {
  test(`an existing ${pending} mutation disables competing actions`, () => {
    const { requests } = setup(); state[pending].isPending = true;
    const actions = render(ride('arriving'));
    assert.equal(actions.busy, true);
    assert.equal(actions.notifyingOnTheWay, pending === 'notice');
    actions.advance('arriving'); actions.cancel('arriving'); actions.notifyOnTheWay();
    assert.deepEqual(requests, []);
  });
}
test('a lost response refreshes both participants and detail, then unlocks retry', async () => {
  const { requests, invalidated } = setup(); const value = ride('arriving');
  render(value).advance('arriving');
  requests[0].reject(new Error('Connection lost')); await settle();
  assert.deepEqual(invalidated, [['ride', 'trip-a'], ['driver-active-ride'], ['passenger-active-ride']]);
  render(value).advance('arriving');
  assert.equal(requests.length, 2);
  requests[1].resolve(ride('in_progress')); await settle();
});
for (const action of ['advance', 'cancel']) {
  test(`a delayed ${action} confirmation is ignored after the trip changes stage`, () => {
    const { requests } = setup(); const confirmation = render(ride('accepted'));
    render(ride('arriving'));
    confirmation[action]('accepted');
    assert.deepEqual(requests, []);
  });
}
test('a confirmation belonging to the previous trip cannot send after navigation', () => {
  const { requests } = setup(); const confirmation = render(ride());
  render(ride('accepted', { id: 'trip-b' })); confirmation.cancel('accepted');
  assert.deepEqual(requests, []);
});
test('a confirmation cannot bypass a mutation that started in a later render', () => {
  const { requests } = setup(); const confirmation = render(ride());
  state.update.isPending = true; render(ride()); confirmation.cancel('accepted');
  assert.deepEqual(requests, []);
});
test('an old pickup action is ignored after its acknowledgement arrives by websocket', () => {
  const { requests } = setup(); const before = render(ride('arriving'));
  render(ride('arriving', { riderOnTheWayAt: '2026-09-19T18:00:00Z' }));
  before.notifyOnTheWay(); assert.deepEqual(requests, []);
});
test('pickup acknowledgement blocks repeated taps and clears errors before retry', async () => {
  const { requests } = setup(); state.notice.error = new Error('Offline');
  const actions = render(ride('arriving')); assert.equal(actions.error, 'Offline');
  actions.notifyOnTheWay(); actions.notifyOnTheWay(); actions.advance('arriving');
  assert.deepEqual(requests.map(request => request.name), ['notice']);
  assert.equal(state.notice.error, null);
  requests[0].resolve(ride('arriving', { riderOnTheWayAt: 'saved' })); await settle();
});
test('a stale pickup error disappears once acknowledged or after departure', () => {
  setup(); state.notice.error = new Error('Offline');
  assert.equal(render(ride('arriving')).error, 'Offline');
  assert.equal(render(ride('arriving', { riderOnTheWayAt: 'saved' })).error, null);
  assert.equal(render(ride('in_progress')).error, null);
});
test('contact without a telephone or trip makes no native call', () => {
  setup(); const calls = []; state.openURL = input => calls.push(input); state.share = input => calls.push(input);
  for (const phone of [undefined, null, '']) {
    const actions = contact(undefined, phone); actions.call(); actions.message(); actions.share();
  }
  assert.deepEqual(calls, []);
});
test('native contact failures are displayed and a successful retry clears the error', async () => {
  setup(); const urls = [];
  state.openURL = async url => { urls.push(url); throw new Error('No native handler'); };
  contact(ride(), '+59170000001').call(); await settle();
  assert.match(contact(ride(), '+59170000001').error, /llamada/);
  state.openURL = async url => { urls.push(url); };
  contact(ride(), '+59170000001').message(); await settle();
  assert.equal(contact(ride(), '+59170000001').error, null);
  assert.deepEqual(urls, ['tel:+59170000001', 'sms:+59170000001']);
});
for (const service of ['taxi', 'moto']) {
  test(`${service} sharing includes the route and assigned vehicle snapshot`, async () => {
    setup(); const shared = [];
    state.share = async input => { shared.push(input.message); };
    const value = ride('in_progress', { service, driver: { fullName: 'Ana', vehicleModel: 'Model A', plate: 'ABC-123' } });
    contact(value).share(); await settle();
    assert.deepEqual(shared, [`${service === 'moto' ? 'Mototaxi' : 'Taxi'} con ViajaYa: Casa → Trabajo. Conductor: Ana · Model A · ABC-123.`]);
    state.share = async () => { throw new Error('Unavailable'); };
    contact(value).share(); await settle();
    assert.match(contact(value).error, /compartir/);
  });
}
