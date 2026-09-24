import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import { createReplayGate } from '../src/core/realtime/replayGate.ts';
import { useDriverRequests } from '../src/features/driver/application/useDriverRequests.ts';
import { createRealtimeReplayConsumer } from '../src/features/rides/application/realtimeReplayConsumer.ts';
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === './rideStatusReducer' ? './rideStatusReducer.ts' : specifier, context);
  },
});
const {
  applyDriverRealtimeSnapshot,
  applyPassengerRealtimeSnapshot,
} = await import('../src/features/rides/application/realtimeSnapshots.ts');
hooks.deregister();

function place(name) {
  return {
    coordinates: { latitude: -16.5, longitude: -68.15 },
    name,
    address: `${name}, La Paz`,
    countryCode: 'BO',
  };
}

function ride(id, status = 'searching') {
  return {
    id,
    riderId: 'rider-1',
    rider: {
      id: 'rider-1',
      fullName: 'Pasajero',
      phone: null,
      rating: 4.9,
    },
    status,
    paused: false,
    service: 'taxi',
    payment: 'cash',
    fare: 20,
    origin: place('Origen'),
    destination: place('Destino'),
    driver: null,
    acceptedPrice: null,
    acceptedEtaMin: null,
  };
}

function openRide(id, poolVersion, fare = 20) {
  return {
    id,
    service: 'taxi',
    payment: 'cash',
    fare,
    origin: place('Origen'),
    destination: place('Destino'),
    rider: {
      id: `rider-${id}`,
      fullName: 'Pasajero',
      rating: 4.8,
      tripsCompleted: 5,
    },
    poolVersion,
    createdAt: '2026-07-22T12:00:00Z',
  };
}

function offer(id, rideId) {
  return {
    id,
    rideId,
    price: 25,
    etaMin: 5,
    status: 'pending',
    driver: {
      id: 'driver-1',
      fullName: 'Conductor',
      rating: 4.8,
      vehicleType: 'taxi',
      plate: 'ABC-123',
      vehicleModel: 'Sedán',
    },
    createdAt: '2026-07-22T12:00:00Z',
    expiresAt: '2099-07-22T12:00:30Z',
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('ride_snapshot replaces the passenger\'s detail, offers and active ride', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const currentRide = ride('ride-1');
  queryClient.setQueryData(['ride', 'ride-1'], ride('ride-old'));
  queryClient.setQueryData(['ride-offers', 'ride-1'], [offer('old', 'ride-1')]);

  await applyPassengerRealtimeSnapshot(
    queryClient,
    ['passenger-active-ride'],
    { ride: currentRide, offers: [offer('offer-1', 'ride-1')] },
  );

  assert.equal(queryClient.getQueryData(['ride', 'ride-1']).id, 'ride-1');
  assert.deepEqual(
    queryClient.getQueryData(['ride-offers', 'ride-1']).map((item) => item.id),
    ['offer-1'],
  );
  assert.equal(queryClient.getQueryData(['passenger-active-ride']).id, 'ride-1');
  queryClient.clear();
});

test('driver_snapshot replaces open, paused, offers and active_ride null', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store = useDriverRequests.getState();
  store.reset();
  const attempt = store.beginOfferAttempt('old-ride');
  store.markOffered(
    'old-ride',
    {
      id: 'old-offer',
      price: 10,
      etaMin: 5,
      createdAt: '2026-07-22T11:00:00Z',
      expiresAt: '2099-07-22T12:00:30Z',
    },
    10,
    attempt,
  );
  queryClient.setQueryData(['driver-active-ride'], ride('old-active'));
  const open = openRide('open-1', 2, 30);
  const paused = openRide('paused-1', 4, 40);
  let notifications = 0;
  let queryStateObservedFromStore = null;
  const unsubscribe = useDriverRequests.subscribe(() => {
    notifications += 1;
    queryStateObservedFromStore = {
      open: queryClient.getQueryData(['open-rides']),
      active: queryClient.getQueryData(['driver-active-ride']),
    };
  });

  await applyDriverRealtimeSnapshot(
    queryClient,
    ['driver-active-ride'],
    store,
    {
      openRides: { items: [open], nextCursor: 'next' },
      pausedRides: [paused],
      offers: [offer('offer-1', 'open-1')],
      activeRide: null,
    },
  );
  unsubscribe();

  const cached = queryClient.getQueryData(['open-rides']);
  assert.deepEqual(
    cached.pages.flatMap((page) => page.items.map((item) => item.id)),
    ['paused-1', 'open-1'],
  );
  assert.equal(queryClient.getQueryData(['driver-active-ride']), null);
  const state = useDriverRequests.getState();
  assert.deepEqual(Object.keys(state.offered), ['open-1']);
  assert.equal(state.offered['open-1'].offerId, 'offer-1');
  assert.equal(state.paused.has('paused-1'), true);
  assert.deepEqual(state.poolProjection.get('open-1'), {
    poolVersion: 2,
    phase: 'open',
  });
  assert.equal(state.offerSnapshotAttemptSequence, 2);
  assert.equal(state.offerSnapshotAppliedAttemptSequence, 3);
  // The missing local HTTP offer is cleared and a second confirmation is requested.
  assert.equal(state.realtimeResyncSequence, 1);
  assert.equal(notifications, 1);
  assert.equal(queryStateObservedFromStore.active, null);
  assert.deepEqual(
    queryStateObservedFromStore.open.pages[0].items.map((item) => item.id),
    ['paused-1', 'open-1'],
  );
  store.reset();
  queryClient.clear();
});

test('driver_snapshot keeps the local fare of an offer outside the page', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store = useDriverRequests.getState();
  store.reset();
  const attempt = store.beginOfferAttempt('outside-page');
  store.markOffered(
    'outside-page',
    {
      id: 'local-offer',
      price: 25,
      etaMin: 5,
      expiresAt: '2099-07-22T12:00:30Z',
    },
    42,
    attempt,
  );

  await applyDriverRealtimeSnapshot(
    queryClient,
    ['driver-active-ride'],
    store,
    {
      openRides: { items: [], nextCursor: null },
      pausedRides: [],
      offers: [offer('current-offer', 'outside-page')],
      activeRide: null,
    },
  );

  assert.equal(
    useDriverRequests.getState().offered['outside-page'].rideFare,
    42,
  );
  store.reset();
  queryClient.clear();
});

test('an assigned driver_snapshot clears the offer in a single transition', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store = useDriverRequests.getState();
  store.reset();
  const activeRide = ride('assigned-1', 'accepted');
  const attempt = store.beginOfferAttempt(activeRide.id);
  store.markOffered(
    activeRide.id,
    {
      id: 'assigned-offer',
      price: 25,
      etaMin: 5,
      expiresAt: '2099-07-22T12:00:30Z',
    },
    20,
    attempt,
  );
  let notifications = 0;
  const unsubscribe = useDriverRequests.subscribe(() => {
    notifications += 1;
  });

  await applyDriverRealtimeSnapshot(
    queryClient,
    ['driver-active-ride'],
    store,
    {
      openRides: { items: [], nextCursor: null },
      pausedRides: [],
      offers: [offer('assigned-offer', activeRide.id)],
      activeRide,
    },
  );
  unsubscribe();

  const state = useDriverRequests.getState();
  assert.equal(notifications, 1);
  assert.equal(state.offered[activeRide.id], undefined);
  assert.equal(state.terminalRideIds.has(activeRide.id), true);
  assert.equal(queryClient.getQueryData(['driver-active-ride']).id, activeRide.id);
  assert.equal(queryClient.getQueryData(['ride', activeRide.id]).id, activeRide.id);
  store.reset();
  queryClient.clear();
});

test('a generation invalidated during the snapshot mutates no projection', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const release = deferred();
  queryClient.cancelQueries = async () => release.promise;
  queryClient.setQueryData(['open-rides'], { pages: [], pageParams: [] });
  queryClient.setQueryData(['driver-active-ride'], ride('old-active'));
  const store = useDriverRequests.getState();
  store.reset();
  let current = true;
  let notifications = 0;
  const unsubscribe = useDriverRequests.subscribe(() => {
    notifications += 1;
  });

  const applying = applyDriverRealtimeSnapshot(
    queryClient,
    ['driver-active-ride'],
    store,
    {
      openRides: { items: [openRide('new-open', 1)], nextCursor: null },
      pausedRides: [],
      offers: [],
      activeRide: null,
    },
    () => current,
  );
  current = false;
  release.resolve();
  await applying;
  unsubscribe();

  assert.deepEqual(queryClient.getQueryData(['open-rides']), {
    pages: [],
    pageParams: [],
  });
  assert.equal(queryClient.getQueryData(['driver-active-ride']).id, 'old-active');
  assert.equal(notifications, 0);
  assert.equal(useDriverRequests.getState().poolProjection.size, 0);
  store.reset();
  queryClient.clear();
});

test('driver_snapshot detects a 201 applied while cancelling queries', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const release = deferred();
  queryClient.cancelQueries = async () => release.promise;
  const store = useDriverRequests.getState();
  store.reset();
  const attempt = store.beginOfferAttempt('ride-race');

  const applying = applyDriverRealtimeSnapshot(
    queryClient,
    ['driver-active-ride'],
    store,
    {
      openRides: { items: [], nextCursor: null },
      pausedRides: [],
      offers: [],
      activeRide: null,
    },
  );
  assert.equal(
    store.markOffered(
      'ride-race',
      {
        id: 'offer-race',
        price: 20,
        etaMin: 5,
        createdAt: '2026-07-22T12:00:00Z',
        expiresAt: '2099-07-22T12:00:30Z',
      },
      20,
      attempt,
    ),
    true,
  );
  release.resolve();
  await applying;

  assert.equal(useDriverRequests.getState().offered['ride-race'], undefined);
  assert.equal(useDriverRequests.getState().realtimeResyncSequence, 1);
  store.reset();
  queryClient.clear();
});

test('snapshot and a duplicated v2 delta update a real cache only once', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const currentRide = ride('ride-1');
  const firstOffer = offer('offer-1', 'ride-1');
  const secondOffer = offer('offer-2', 'ride-1');
  const gate = createReplayGate();
  const resyncs = [];
  const consumer = createRealtimeReplayConsumer({
    gate,
    classify(message) {
      return message.kind === 'snapshot'
        ? {
            protocol: 'v2',
            kind: 'snapshot',
            checkpoints: [{ stream: 'ride:ride-1', version: 10 }],
            requiredStreams: ['ride:ride-1'],
          }
        : {
            protocol: 'v2',
            kind: 'event',
            metadata: {
              eventId: 'event-11',
              batchId: 'batch-11',
              correlationId: 'correlation-11',
              sequence: 0,
              eventType: 'offer_created',
              aggregateType: 'ride',
              aggregateId: 'ride-1',
              aggregateVersion: 11,
              stream: 'ride:ride-1',
              streamVersion: message.version,
              occurredAt: '2026-07-22T12:00:01Z',
              payloadFingerprint: 'offer-2',
            },
          };
    },
    async applyLegacy() {
      throw new Error('Legacy was not expected.');
    },
    async applySnapshot() {
      await applyPassengerRealtimeSnapshot(
        queryClient,
        ['passenger-active-ride'],
        { ride: currentRide, offers: [firstOffer] },
      );
    },
    async applyEvent() {
      queryClient.setQueryData(['ride-offers', 'ride-1'], (current = []) => [
        ...current,
        secondOffer,
      ]);
    },
    onResync(reason) {
      resyncs.push(reason);
    },
  });
  consumer.beginConnection();

  await consumer.consume({ kind: 'snapshot' });
  await consumer.consume({ kind: 'event', version: 11 });
  await consumer.consume({ kind: 'event', version: 11 });

  assert.deepEqual(
    queryClient.getQueryData(['ride-offers', 'ride-1']).map((item) => item.id),
    ['offer-1', 'offer-2'],
  );
  assert.deepEqual(resyncs, []);
  queryClient.clear();
});

for (const role of ['passenger', 'driver']) {
  for (const status of ['arriving', 'in_progress']) {
    test(`${role} snapshot in flight cannot erase a confirmed pickup notice or regress departure (${status})`, async () => {
      const queryClient = new QueryClient();
      const activeKey = [`${role}-active-ride`];
      const captured = { ...ride('pickup', 'arriving'), riderOnTheWayAt: null };
      const confirmed = { ...captured, status, riderOnTheWayAt: '2026-09-19T16:00:00Z' };
      const release = deferred();
      queryClient.cancelQueries = () => release.promise;
      const store = useDriverRequests.getState();
      store.reset();
      const applying = role === 'passenger'
        ? applyPassengerRealtimeSnapshot(queryClient, activeKey, { ride: captured, offers: [] })
        : applyDriverRealtimeSnapshot(queryClient, activeKey, store, {
            openRides: { items: [], nextCursor: null }, pausedRides: [], offers: [], activeRide: captured,
          });
      queryClient.setQueryData(['ride', 'pickup'], confirmed);
      queryClient.setQueryData(activeKey, confirmed);
      release.resolve();
      await applying;
      assert.deepEqual(queryClient.getQueryData(['ride', 'pickup']), confirmed);
      assert.deepEqual(queryClient.getQueryData(activeKey), confirmed);
      store.reset();
      queryClient.clear();
    });
  }
}
