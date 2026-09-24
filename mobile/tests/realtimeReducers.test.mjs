import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import {
  MAX_DRIVER_POOL_CYCLES,
  reduceDriverPoolEvent,
  useDriverRequests,
} from '../src/features/driver/application/useDriverRequests.ts';
import {
  flattenOpenRides,
  openRidesSnapshot,
  removeOpenRide,
  versionedOpenRidesSnapshot,
} from '../src/features/rides/application/openRidesCache.ts';
import { reducePassengerOffers } from '../src/features/rides/application/passengerOffersReducer.ts';
import {
  applyRideMutationResult,
  reduceDriverActiveRide,
  reducePassengerActiveRide,
  reduceRideMutationResult,
  shouldApplyRideStatus,
} from '../src/features/rides/application/rideStatusReducer.ts';

function offer(id, driverId, price = 20) {
  return {
    id,
    rideId: 'ride-1',
    price,
    etaMin: 5,
    status: 'pending',
    driver: {
      id: driverId,
      fullName: `Conductor ${driverId}`,
      rating: 4.8,
      vehicleType: 'taxi',
      plate: 'ABC-123',
      vehicleModel: 'Sedán',
    },
    createdAt: '2026-07-18T12:00:00Z',
    expiresAt: '2026-07-18T12:00:30Z',
  };
}

function ride(id, status) {
  const place = {
    coordinates: { latitude: -16.5, longitude: -68.15 },
    name: 'Lugar',
    address: 'Dirección',
    countryCode: 'BO',
  };
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
    origin: place,
    destination: place,
    driver: null,
    acceptedPrice: null,
    acceptedEtaMin: null,
  };
}

function sentOffer(id, price = 20) {
  return {
    id,
    price,
    etaMin: 5,
    expiresAt: '2099-07-18T12:00:30Z',
  };
}

function applySentOffer(store, rideId, offer, rideFare) {
  const attemptToken = store.beginOfferAttempt(rideId);
  return store.markOffered(rideId, offer, rideFare, attemptToken);
}

function openRide(id, poolVersion, fare = 20) {
  const place = {
    coordinates: { latitude: -16.5, longitude: -68.15 },
    name: 'Lugar',
    address: 'Dirección',
    countryCode: 'BO',
  };
  return {
    id,
    service: 'taxi',
    payment: 'cash',
    fare,
    origin: place,
    destination: place,
    rider: {
      id: `rider-${id}`,
      fullName: 'Pasajero',
      rating: 4.9,
      tripsCompleted: 10,
    },
    poolVersion,
    createdAt: '2026-07-18T12:00:00Z',
  };
}

function reducePool(events) {
  let projection = new Map();
  let reduction = null;
  for (const event of events) {
    reduction = reduceDriverPoolEvent(projection, event);
    projection = reduction.projection;
  }
  return { projection, reduction };
}

test('the snapshot replaces the previous offers', () => {
  const incoming = [offer('new', 'driver-new')];
  const result = reducePassengerOffers([offer('old', 'driver-old')], {
    type: 'snapshot',
    offers: incoming,
  });

  assert.deepEqual(result.offers, incoming);
  assert.notStrictEqual(result.offers, incoming);
  assert.equal(result.notice, null);
});

test('a duplicated event updates without repeating the notification', () => {
  const previous = offer('offer-1', 'driver-1', 20);
  const updated = offer('offer-1', 'driver-1', 22);
  const result = reducePassengerOffers([previous], {
    type: 'created',
    offer: updated,
  });

  assert.deepEqual(result.offers, [updated]);
  assert.equal(result.notice, null);
  assert.equal(previous.price, 20);
});

test('a new offer replaces the same driver\'s previous one', () => {
  const retained = offer('other', 'driver-2');
  const replacement = offer('new', 'driver-1', 25);
  const result = reducePassengerOffers(
    [offer('old', 'driver-1'), retained],
    { type: 'created', offer: replacement },
  );

  assert.deepEqual(result.offers, [replacement, retained]);
  assert.deepEqual(result.notice, { kind: 'received', offer: replacement });
});

test('a superseded withdrawal keeps the reference to avoid flicker', () => {
  const current = [offer('offer-1', 'driver-1')];
  const result = reducePassengerOffers(current, {
    type: 'withdrawn',
    driverId: 'driver-1',
    offerId: 'offer-1',
    reason: 'superseded',
  });

  assert.strictEqual(result.offers, current);
  assert.equal(result.notice, null);
});

test('a withdrawal by id removes only the given offer', () => {
  const removed = offer('offer-1', 'driver-1');
  const retained = offer('offer-2', 'driver-2');
  const result = reducePassengerOffers([removed, retained], {
    type: 'withdrawn',
    driverId: 'driver-1',
    offerId: 'offer-1',
  });

  assert.deepEqual(result.offers, [retained]);
  assert.deepEqual(result.notice, { kind: 'withdrawn', offer: removed });
});

test('a withdrawal without id removes the offer by driver', () => {
  const removed = offer('offer-1', 'driver-1');
  const retained = offer('offer-2', 'driver-2');
  const result = reducePassengerOffers([removed, retained], {
    type: 'withdrawn',
    driverId: 'driver-1',
  });

  assert.deepEqual(result.offers, [retained]);
  assert.deepEqual(result.notice, { kind: 'withdrawn', offer: removed });
});

test('an expiry removes by id and describes the notification', () => {
  const expired = offer('offer-1', 'driver-1');
  const retained = offer('offer-2', 'driver-2');
  const result = reducePassengerOffers([expired, retained], {
    type: 'expired',
    offerId: 'offer-1',
  });

  assert.deepEqual(result.offers, [retained]);
  assert.deepEqual(result.notice, { kind: 'expired', offer: expired });
});

test('a late expiry does not remove the same driver\'s new offer', () => {
  const replacement = offer('offer-2', 'driver-1');
  const result = reducePassengerOffers([replacement], {
    type: 'expired',
    offerId: 'offer-1',
  });

  assert.deepEqual(result.offers, [replacement]);
  assert.equal(result.notice, null);
});

test('a terminal ride does not go back because of a late event', () => {
  assert.equal(
    shouldApplyRideStatus(ride('ride-1', 'cancelled'), ride('ride-1', 'searching')),
    false,
  );
  assert.equal(
    shouldApplyRideStatus(ride('ride-1', 'completed'), ride('ride-1', 'completed')),
    true,
  );
  assert.equal(
    shouldApplyRideStatus(ride('ride-1', 'completed'), ride('ride-2', 'searching')),
    true,
  );
});

test('ride statuses advance monotonically and can be refreshed', () => {
  const forwardTransitions = [
    ['searching', 'accepted'],
    ['accepted', 'arriving'],
    ['arriving', 'in_progress'],
    ['in_progress', 'completed'],
    ['searching', 'in_progress'],
  ];
  for (const [current, incoming] of forwardTransitions) {
    assert.equal(
      shouldApplyRideStatus(ride('ride-1', current), ride('ride-1', incoming)),
      true,
      `${current} → ${incoming}`,
    );
  }

  for (const status of ['searching', 'accepted', 'arriving', 'in_progress']) {
    assert.equal(
      shouldApplyRideStatus(ride('ride-1', status), ride('ride-1', status)),
      true,
      `refresco ${status}`,
    );
  }
});

test('ride statuses reject non-terminal regressions', () => {
  const regressions = [
    ['accepted', 'searching'],
    ['arriving', 'accepted'],
    ['in_progress', 'arriving'],
    ['in_progress', 'searching'],
  ];
  for (const [current, incoming] of regressions) {
    assert.equal(
      shouldApplyRideStatus(ride('ride-1', current), ride('ride-1', incoming)),
      false,
      `${current} → ${incoming}`,
    );
  }
});

test('cancelled is only accepted before the ride starts', () => {
  for (const status of ['searching', 'accepted', 'arriving']) {
    assert.equal(
      shouldApplyRideStatus(ride('ride-1', status), ride('ride-1', 'cancelled')),
      true,
      `${status} → cancelled`,
    );
  }
  assert.equal(
    shouldApplyRideStatus(
      ride('ride-1', 'in_progress'),
      ride('ride-1', 'cancelled'),
    ),
    false,
  );
  assert.equal(
    shouldApplyRideStatus(
      ride('ride-1', 'cancelled'),
      ride('ride-1', 'completed'),
    ),
    false,
  );
});

test('a late HTTP accepted response does not replace the cancelled received over WS', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const detailKey = ['ride', 'ride-1'];
  const activeKey = ['passenger-active-ride'];
  let resolveHttp;
  const httpResponse = new Promise((resolve) => {
    resolveHttp = resolve;
  });
  queryClient.setQueryData(detailKey, ride('ride-1', 'searching'));
  queryClient.setQueryData(activeKey, ride('ride-1', 'searching'));
  const applyHttpResponse = httpResponse.then((incoming) => {
    if (applyRideMutationResult(queryClient, incoming)) {
      queryClient.setQueryData(activeKey, incoming);
    }
  });

  // The WebSocket gets ahead while the HTTP request is still pending.
  const cancelled = ride('ride-1', 'cancelled');
  queryClient.setQueryData(detailKey, cancelled);
  queryClient.setQueryData(activeKey, null);
  resolveHttp(ride('ride-1', 'accepted'));
  await applyHttpResponse;

  assert.deepEqual(queryClient.getQueryData(detailKey), cancelled);
  assert.equal(queryClient.getQueryData(activeKey), null);
  queryClient.clear();
});

test('a normal HTTP response advances the non-terminal ride', () => {
  const accepted = ride('ride-1', 'accepted');
  const reduction = reduceRideMutationResult(
    ride('ride-1', 'searching'),
    accepted,
  );

  assert.equal(reduction.applied, true);
  assert.strictEqual(reduction.ride, accepted);
});

test('a late HTTP response respects the more advanced active cache', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const activeKey = ['driver-active-ride'];
  const arriving = ride('ride-1', 'arriving');
  queryClient.setQueryData(activeKey, arriving);

  const applied = applyRideMutationResult(
    queryClient,
    ride('ride-1', 'accepted'),
    activeKey,
  );

  assert.equal(applied, false);
  assert.equal(queryClient.getQueryData(['ride', 'ride-1']), undefined);
  assert.strictEqual(queryClient.getQueryData(activeKey), arriving);
  queryClient.clear();
});

test('an HTTP response with the same terminal status can refresh its data', () => {
  const cancelled = ride('ride-1', 'cancelled');
  const reduction = reduceRideMutationResult(
    ride('ride-1', 'cancelled'),
    cancelled,
  );

  assert.equal(reduction.applied, true);
  assert.strictEqual(reduction.ride, cancelled);
});

test('the passenger\'s active ride is recovered, updated and cleared when it ends', () => {
  const searching = ride('ride-1', 'searching');
  const accepted = ride('ride-1', 'accepted');
  const completed = ride('ride-1', 'completed');

  assert.deepEqual(reducePassengerActiveRide(null, searching), searching);
  assert.deepEqual(reducePassengerActiveRide(searching, accepted), accepted);
  assert.equal(reducePassengerActiveRide(accepted, completed), null);
  assert.deepEqual(
    reducePassengerActiveRide(ride('other', 'accepted'), completed),
    ride('other', 'accepted'),
  );
});

test('the driver\'s active ride only changes when the ride matches', () => {
  const current = ride('ride-1', 'accepted');
  const arriving = ride('ride-1', 'arriving');
  const other = ride('ride-2', 'arriving');

  assert.deepEqual(reduceDriverActiveRide(current, arriving), arriving);
  assert.strictEqual(reduceDriverActiveRide(current, other), current);
  assert.equal(reduceDriverActiveRide(null, arriving), null);
});

test('the active reducers do not allow regressions either', () => {
  const inProgress = ride('ride-1', 'in_progress');
  const arriving = ride('ride-1', 'arriving');

  assert.strictEqual(
    reducePassengerActiveRide(inProgress, arriving),
    inProgress,
  );
  assert.strictEqual(reduceDriverActiveRide(inProgress, arriving), inProgress);
});

test('the driver\'s expiry compares offerId and is idempotent', () => {
  const store = useDriverRequests.getState();
  store.reset();
  applySentOffer(store, 'ride-1', sentOffer('offer-1'), 18);
  applySentOffer(store, 'ride-1', sentOffer('offer-2', 22), 19);

  assert.equal(store.markExpired('ride-1', 'offer-1'), false);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-2');
  assert.equal(useDriverRequests.getState().expired.has('ride-1'), false);

  assert.equal(store.markExpired('ride-1', 'offer-2'), true);
  assert.equal(store.markExpired('ride-1', 'offer-2'), false);
  assert.equal(useDriverRequests.getState().offered['ride-1'], undefined);
  assert.equal(useDriverRequests.getState().expired.has('ride-1'), true);
  assert.equal(useDriverRequests.getState().expiredFares['ride-1'], 19);
  store.reset();
});

test('the summarized withdrawal removes only the given rides and tolerates duplicates', () => {
  const store = useDriverRequests.getState();
  store.reset();
  applySentOffer(store, 'ride-1', sentOffer('offer-1'));
  applySentOffer(store, 'ride-2', sentOffer('offer-2'));

  assert.equal(store.withdrawOffered(['ride-1', 'ride-1']), 1);
  assert.equal(store.withdrawOffered(['ride-1']), 0);
  assert.equal(useDriverRequests.getState().offered['ride-1'], undefined);
  assert.equal(useDriverRequests.getState().offered['ride-2'].offerId, 'offer-2');
  store.reset();
});

test('a WS rejection before the HTTP response prevents reviving the same offer', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const attemptToken = store.beginOfferAttempt('ride-1');

  assert.equal(store.markRejected('ride-1', 'offer-1'), true);
  assert.equal(store.markRejected('ride-1', 'offer-1'), false);
  assert.equal(
    store.markOffered('ride-1', sentOffer('offer-1'), undefined, attemptToken),
    false,
  );
  assert.equal(useDriverRequests.getState().offered['ride-1'], undefined);
  assert.equal(useDriverRequests.getState().rejected.has('ride-1'), true);
  store.reset();
});

test('a legitimate re-offer does not inherit the previous offer\'s tombstone', () => {
  const store = useDriverRequests.getState();
  store.reset();
  store.markRejected('ride-1', 'offer-1');

  assert.equal(applySentOffer(store, 'ride-1', sentOffer('offer-2')), true);
  assert.equal(useDriverRequests.getState().rejected.has('ride-1'), false);
  assert.equal(store.markRejected('ride-1', 'offer-1'), false);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-2');
  store.reset();
});

test('exact expiry and pause block their late HTTP response', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const expiredAttempt = store.beginOfferAttempt('ride-1');
  const pausedAttempt = store.beginOfferAttempt('ride-2');

  assert.equal(store.markExpired('ride-1', 'offer-expired'), true);
  assert.equal(
    store.markOffered(
      'ride-1',
      sentOffer('offer-expired'),
      undefined,
      expiredAttempt,
    ),
    false,
  );
  assert.equal(store.markPaused('ride-2', 'offer-paused'), true);
  assert.equal(
    store.markOffered(
      'ride-2',
      sentOffer('offer-paused'),
      undefined,
      pausedAttempt,
    ),
    false,
  );
  assert.equal(useDriverRequests.getState().expired.has('ride-1'), true);
  assert.equal(useDriverRequests.getState().paused.has('ride-2'), true);
  store.reset();
});

test('an assigned, taken or cancelled ride blocks any late offer', () => {
  const store = useDriverRequests.getState();
  store.reset();

  const assignedAttempt = store.beginOfferAttempt('ride-assigned');
  assert.equal(store.markAssigned('ride-assigned'), true);
  assert.equal(
    store.markOffered(
      'ride-assigned',
      sentOffer('offer-a'),
      undefined,
      assignedAttempt,
    ),
    false,
  );
  const takenAttempt = store.beginOfferAttempt('ride-taken');
  assert.equal(store.markTaken('ride-taken'), true);
  assert.equal(
    store.markOffered(
      'ride-taken',
      sentOffer('offer-b'),
      undefined,
      takenAttempt,
    ),
    false,
  );
  const cancelledAttempt = store.beginOfferAttempt('ride-cancelled');
  assert.equal(store.markCancelled('ride-cancelled', 'offer-c'), true);
  assert.equal(
    store.markOffered(
      'ride-cancelled',
      sentOffer('offer-c'),
      undefined,
      cancelledAttempt,
    ),
    false,
  );
  assert.equal(store.markAssigned('ride-assigned'), false);
  store.reset();
});

test('ride_closed and offer_rejected converge in any order', () => {
  const reduceInOrder = (closedFirst) => {
    const store = useDriverRequests.getState();
    store.reset();
    applySentOffer(store, 'ride-1', sentOffer('offer-1'));
    if (closedFirst) {
      store.withdrawOffered(['ride-1']);
      store.markRejected('ride-1', 'offer-1');
    } else {
      store.markRejected('ride-1', 'offer-1');
      store.withdrawOffered(['ride-1']);
    }
    const state = useDriverRequests.getState();
    return {
      offered: state.offered['ride-1'] ?? null,
      rejected: state.rejected.has('ride-1'),
      settled: state.settledOfferIds.has('offer-1'),
    };
  };

  assert.deepEqual(reduceInOrder(true), reduceInOrder(false));
  useDriverRequests.getState().reset();
});

test('the PENDING snapshot corrects a local expiry caused by a clock running ahead', () => {
  const store = useDriverRequests.getState();
  store.reset();
  store.markExpired('ride-1', 'offer-1');

  store.reconcileOffered([
    {
      rideId: 'ride-1',
      id: 'offer-1',
      price: 20,
      rideFare: 20,
      etaMin: 5,
      // Simulates a device clock ahead of the server's.
      expiresAt: '2000-07-18T12:00:30Z',
    },
  ]);

  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-1');
  assert.equal(useDriverRequests.getState().expired.has('ride-1'), false);
  assert.equal(useDriverRequests.getState().settledOfferIds.has('offer-1'), false);
  assert.equal(
    new Date(useDriverRequests.getState().offered['ride-1'].expiresAt).getTime() >
      Date.now(),
    true,
  );
  store.reset();
});

test('a covered but missing attempt forces a resnapshot and a later one is admitted', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const oldAttempt = store.beginOfferAttempt('ride-old');
  store.reconcileOffered([], store.beginOfferSnapshot());

  assert.equal(
    store.markOffered(
      'ride-old',
      sentOffer('offer-old'),
      20,
      oldAttempt,
    ),
    false,
  );
  assert.equal(useDriverRequests.getState().offered['ride-old'], undefined);
  assert.equal(
    useDriverRequests.getState().realtimeResyncSequence,
    1,
  );

  const newAttempt = store.beginOfferAttempt('ride-new');
  assert.equal(
    store.markOffered(
      'ride-new',
      sentOffer('offer-new'),
      20,
      newAttempt,
    ),
    true,
  );
  assert.equal(
    useDriverRequests.getState().offered['ride-new'].offerId,
    'offer-new',
  );
  assert.equal(useDriverRequests.getState().realtimeResyncSequence, 1);
  store.reset();
});

test('a 201 resolving during the snapshot is not erased without a resync', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const attempt = store.beginOfferAttempt('ride-race');
  const cut = store.beginOfferSnapshot();

  assert.equal(
    store.markOffered(
      'ride-race',
      sentOffer('offer-race'),
      20,
      attempt,
    ),
    true,
  );
  store.reconcileOffered([], cut);

  assert.equal(useDriverRequests.getState().offered['ride-race'], undefined);
  assert.equal(useDriverRequests.getState().realtimeResyncSequence, 1);
  store.reset();
});

test('a 201 applied before creating the cut also forces a resnapshot', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const attempt = store.beginOfferAttempt('ride-before-frame');
  store.markOffered(
    'ride-before-frame',
    sentOffer('offer-before-frame'),
    20,
    attempt,
  );
  const cut = store.beginOfferSnapshot();

  store.reconcileOffered([], cut);

  assert.equal(
    useDriverRequests.getState().offered['ride-before-frame'],
    undefined,
  );
  assert.equal(useDriverRequests.getState().realtimeResyncSequence, 1);
  store.reset();
});

test('an offer started after the cut forces confirmation with another snapshot', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const cut = store.beginOfferSnapshot();
  const attempt = store.beginOfferAttempt('ride-newer');
  store.markOffered('ride-newer', sentOffer('offer-newer'), 20, attempt);

  store.reconcileOffered([], cut);

  assert.equal(useDriverRequests.getState().offered['ride-newer'], undefined);
  assert.equal(useDriverRequests.getState().realtimeResyncSequence, 1);
  store.reset();
});

test('an improvement missing from the snapshot forces a resync even if it advances the token', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const firstAttempt = store.beginOfferAttempt('ride-1');
  store.markOffered('ride-1', sentOffer('offer-a'), 20, firstAttempt);
  const cut = store.beginOfferSnapshot();
  const improvedAttempt = store.beginOfferAttempt('ride-1');

  store.reconcileOffered(
    [
      {
        rideId: 'ride-1',
        id: 'offer-a',
        price: 20,
        rideFare: 20,
        etaMin: 5,
        expiresAt: '2099-07-22T12:00:30Z',
      },
    ],
    cut,
  );

  assert.equal(
    store.markOffered(
      'ride-1',
      sentOffer('offer-b'),
      20,
      improvedAttempt,
    ),
    false,
  );
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-a');
  assert.equal(useDriverRequests.getState().realtimeResyncSequence, 1);
  store.reset();
});

test('a snapshot pause invalidates the HTTP response even after resuming', () => {
  const store = useDriverRequests.getState();
  store.reset();
  store.applyPoolEvent({ rideId: 'ride-1', poolVersion: 1, phase: 'open' });
  const oldAttempt = store.beginOfferAttempt('ride-1');
  store.markPaused('ride-1');
  store.applyPoolEvent({ rideId: 'ride-1', poolVersion: 2, phase: 'open' });

  assert.equal(
    store.markOffered('ride-1', sentOffer('offer-old'), undefined, oldAttempt),
    false,
  );
  assert.equal(applySentOffer(store, 'ride-1', sentOffer('offer-new')), true);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-new');
  store.reset();
});

test('a late pause seals its offer without downgrading the new generation', () => {
  const store = useDriverRequests.getState();
  store.reset();
  store.applyPoolEvent({ rideId: 'ride-1', poolVersion: 1, phase: 'open' });
  const oldAttempt = store.beginOfferAttempt('ride-1');
  store.applyPoolEvent({ rideId: 'ride-1', poolVersion: 2, phase: 'open' });

  const delayedPause = store.applyPoolEvent({
    rideId: 'ride-1',
    poolVersion: 1,
    phase: 'paused',
  });
  assert.equal(delayedPause.applied, false);
  assert.equal(store.markWithdrawn('ride-1', 'offer-old'), true);

  assert.equal(
    store.markOffered('ride-1', sentOffer('offer-old'), undefined, oldAttempt),
    false,
  );
  assert.equal(useDriverRequests.getState().paused.has('ride-1'), false);

  assert.equal(applySentOffer(store, 'ride-1', sentOffer('offer-new')), true);
  assert.equal(store.markWithdrawn('ride-1', 'offer-old'), false);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-new');
  store.reset();
});

test('the voluntary withdrawal of A does not remove a later offer B', () => {
  const store = useDriverRequests.getState();
  store.reset();
  applySentOffer(store, 'ride-1', sentOffer('offer-a'));
  applySentOffer(store, 'ride-1', sentOffer('offer-b'));

  assert.equal(store.markWithdrawn('ride-1', 'offer-a'), false);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-b');
  assert.equal(useDriverRequests.getState().settledOfferIds.has('offer-a'), true);
  store.reset();
});

test('the exact withdrawal of A does not invalidate a re-offer B in flight', () => {
  const store = useDriverRequests.getState();
  store.reset();
  applySentOffer(store, 'ride-1', sentOffer('offer-a'));
  const attemptB = store.beginOfferAttempt('ride-1');

  assert.equal(store.markWithdrawn('ride-1', 'offer-a'), true);
  assert.equal(
    store.markOffered('ride-1', sentOffer('offer-b'), undefined, attemptB),
    true,
  );
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-b');
  assert.equal(useDriverRequests.getState().settledOfferIds.has('offer-a'), true);
  store.reset();
});

test('exact offers_withdrawn does CAS by offer_id and its duplicates are idempotent', () => {
  const store = useDriverRequests.getState();
  store.reset();
  applySentOffer(store, 'ride-1', sentOffer('offer-a'));
  applySentOffer(store, 'ride-1', sentOffer('offer-b'));

  assert.equal(
    store.withdrawExactOffers([{ rideId: 'ride-1', offerId: 'offer-a' }]),
    0,
  );
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-b');
  assert.equal(useDriverRequests.getState().settledOfferIds.has('offer-a'), true);

  assert.equal(
    store.withdrawExactOffers([{ rideId: 'ride-1', offerId: 'offer-b' }]),
    1,
  );
  const afterWithdrawal = useDriverRequests.getState();
  const tokenAfterWithdrawal = afterWithdrawal.offerAttemptTokens.get('ride-1');
  assert.equal(afterWithdrawal.offered['ride-1'], undefined);
  assert.equal(afterWithdrawal.settledOfferIds.has('offer-b'), true);

  assert.equal(
    store.withdrawExactOffers([{ rideId: 'ride-1', offerId: 'offer-b' }]),
    0,
  );
  assert.equal(
    useDriverRequests.getState().offerAttemptTokens.get('ride-1'),
    tokenAfterWithdrawal,
  );
  store.reset();
});

test('two overlapping attempts only apply the newest response', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const firstAttempt = store.beginOfferAttempt('ride-1');
  const secondAttempt = store.beginOfferAttempt('ride-1');

  assert.equal(
    store.markOffered('ride-1', sentOffer('offer-a'), undefined, firstAttempt),
    false,
  );
  assert.equal(
    store.markOffered('ride-1', sentOffer('offer-b'), undefined, secondAttempt),
    true,
  );
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-b');
  store.reset();
});

test('going offline invalidates offer responses that are still pending', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const attemptToken = store.beginOfferAttempt('ride-1');
  store.invalidateAllOfferAttempts();

  assert.equal(
    store.markOffered('ride-1', sentOffer('offer-1'), undefined, attemptToken),
    false,
  );
  assert.equal(useDriverRequests.getState().offered['ride-1'], undefined);
  store.reset();
});

test('the historical guards keep a bounded retention', () => {
  const store = useDriverRequests.getState();
  store.reset();
  for (let index = 0; index < 520; index += 1) {
    store.beginOfferAttempt(`ride-${index}`);
    store.markRejected(`ride-${index}`, `offer-${index}`);
  }
  for (let index = 0; index < 270; index += 1) {
    store.markAssigned(`terminal-${index}`);
  }

  assert.equal(useDriverRequests.getState().settledOfferIds.size, 512);
  assert.equal(useDriverRequests.getState().terminalRideIds.size, 256);
  assert.equal(useDriverRequests.getState().offerAttemptTokens.size, 512);
  assert.equal(useDriverRequests.getState().settledOfferIds.has('offer-0'), false);
  assert.equal(useDriverRequests.getState().settledOfferIds.has('offer-519'), true);
  store.reset();
});

test('close and pause of the same version converge regardless of order', () => {
  const opened = { rideId: 'ride-1', poolVersion: 1, phase: 'open' };
  const closedForPause = { rideId: 'ride-1', poolVersion: 1, phase: 'closed' };
  const paused = { rideId: 'ride-1', poolVersion: 1, phase: 'paused' };

  const closeFirst = reducePool([opened, closedForPause, paused]);
  const pauseFirst = reducePool([opened, paused, closedForPause]);

  assert.deepEqual(closeFirst.projection.get('ride-1'), {
    poolVersion: 1,
    phase: 'paused',
  });
  assert.deepEqual(pauseFirst.projection.get('ride-1'), {
    poolVersion: 1,
    phase: 'paused',
  });
  assert.equal(pauseFirst.reduction.kind, 'superseded');
});

test('a terminal close dominates a pause of the same version', () => {
  const opened = { rideId: 'ride-1', poolVersion: 1, phase: 'open' };
  const paused = { rideId: 'ride-1', poolVersion: 1, phase: 'paused' };
  const terminal = { rideId: 'ride-1', poolVersion: 1, phase: 'terminal' };

  for (const events of [
    [opened, paused, terminal],
    [opened, terminal, paused],
  ]) {
    assert.deepEqual(reducePool(events).projection.get('ride-1'), {
      poolVersion: 1,
      phase: 'terminal',
    });
  }
});

test('a duplicated created does not reopen a closed cycle', () => {
  const result = reducePool([
    { rideId: 'ride-1', poolVersion: 1, phase: 'open' },
    { rideId: 'ride-1', poolVersion: 1, phase: 'closed' },
    { rideId: 'ride-1', poolVersion: 1, phase: 'open' },
  ]);

  assert.deepEqual(result.projection.get('ride-1'), {
    poolVersion: 1,
    phase: 'closed',
  });
  assert.equal(result.reduction.kind, 'superseded');
  assert.equal(result.reduction.acceptsPayload, false);
});

test('late closes and pauses do not downgrade a new publication', () => {
  for (const phase of ['closed', 'paused', 'terminal']) {
    const result = reducePool([
      { rideId: 'ride-1', poolVersion: 1, phase: 'open' },
      { rideId: 'ride-1', poolVersion: 2, phase: 'open' },
      { rideId: 'ride-1', poolVersion: 1, phase },
    ]);

    assert.deepEqual(result.projection.get('ride-1'), {
      poolVersion: 2,
      phase: 'open',
    });
    assert.equal(result.reduction.kind, 'stale');
    assert.equal(result.reduction.applied, false);
  }
});

test('only a greater open version clears the driver\'s outcomes', () => {
  const store = useDriverRequests.getState();
  store.reset();

  for (const rideId of ['rejected', 'expired', 'paused']) {
    store.applyPoolEvent({ rideId, poolVersion: 1, phase: 'open' });
  }
  store.markRejected('rejected', 'offer-rejected');
  store.markExpired('expired', 'offer-expired');
  store.applyPoolEvent({ rideId: 'paused', poolVersion: 1, phase: 'paused' });
  store.markPaused('paused', 'offer-paused');
  store.dismiss('rejected', 1);

  const duplicate = store.applyPoolEvent({
    rideId: 'rejected',
    poolVersion: 1,
    phase: 'open',
  });
  assert.equal(duplicate.clearsOutcomes, false);
  assert.equal(duplicate.acceptsPayload, true);
  assert.equal(useDriverRequests.getState().rejected.has('rejected'), true);
  assert.equal(useDriverRequests.getState().dismissed.has('rejected'), true);

  const stalePausedOpen = store.applyPoolEvent({
    rideId: 'paused',
    poolVersion: 1,
    phase: 'open',
  });
  assert.equal(stalePausedOpen.acceptsPayload, false);
  assert.equal(useDriverRequests.getState().paused.has('paused'), true);

  for (const rideId of ['rejected', 'expired', 'paused']) {
    assert.equal(
      store.applyPoolEvent({ rideId, poolVersion: 2, phase: 'open' })
        .clearsOutcomes,
      true,
    );
  }
  const state = useDriverRequests.getState();
  assert.equal(state.rejected.has('rejected'), false);
  assert.equal(state.expired.has('expired'), false);
  assert.equal(state.paused.has('paused'), false);
  assert.equal(state.dismissed.has('rejected'), false);
  store.reset();
});

test('only an applied close withdraws the offer and invalidates its attempt', () => {
  const store = useDriverRequests.getState();
  store.reset();
  store.applyPoolEvent({ rideId: 'ride-1', poolVersion: 2, phase: 'open' });
  applySentOffer(store, 'ride-1', sentOffer('offer-1'));
  const tokenBeforeClose = useDriverRequests.getState().offerAttemptTokens.get('ride-1');

  const stale = store.applyPoolEvent({
    rideId: 'ride-1',
    poolVersion: 1,
    phase: 'closed',
  });
  if (stale.applied) store.withdrawOffered(['ride-1']);
  assert.equal(stale.applied, false);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-1');
  assert.equal(
    useDriverRequests.getState().offerAttemptTokens.get('ride-1'),
    tokenBeforeClose,
  );

  const terminal = store.applyPoolEvent({
    rideId: 'ride-1',
    poolVersion: 2,
    phase: 'terminal',
  });
  if (terminal.applied) store.withdrawOffered(['ride-1']);
  assert.equal(terminal.applied, true);
  assert.equal(useDriverRequests.getState().offered['ride-1'], undefined);
  assert.notEqual(
    useDriverRequests.getState().offerAttemptTokens.get('ride-1'),
    tokenBeforeClose,
  );
  const tokenAfterClose = useDriverRequests.getState().offerAttemptTokens.get('ride-1');
  const duplicate = store.applyPoolEvent({
    rideId: 'ride-1',
    poolVersion: 2,
    phase: 'terminal',
  });
  if (duplicate.applied) store.withdrawOffered(['ride-1']);
  assert.equal(duplicate.applied, false);
  assert.equal(
    useDriverRequests.getState().offerAttemptTokens.get('ride-1'),
    tokenAfterClose,
  );
  store.reset();
});

test('terminal removes a paused card and a late pause does not revive it', () => {
  const store = useDriverRequests.getState();
  store.reset();
  const ride = openRide('ride-1', 1);
  let cache = openRidesSnapshot({ items: [ride], nextCursor: null });
  store.applyPoolEvent({ rideId: ride.id, poolVersion: 1, phase: 'open' });
  const paused = store.applyPoolEvent({
    rideId: ride.id,
    poolVersion: 1,
    phase: 'paused',
  });
  if (paused.applied) store.markPaused(ride.id, 'offer-1');

  const terminal = store.applyPoolEvent({
    rideId: ride.id,
    poolVersion: 1,
    phase: 'terminal',
  });
  if (terminal.applied) {
    cache = removeOpenRide(cache, ride.id);
    store.withdrawOffered([ride.id]);
  }
  assert.deepEqual(flattenOpenRides(cache), []);
  assert.equal(useDriverRequests.getState().paused.has(ride.id), false);

  const delayedPause = store.applyPoolEvent({
    rideId: ride.id,
    poolVersion: 1,
    phase: 'paused',
  });
  if (delayedPause.applied) store.markPaused(ride.id, 'offer-1');
  assert.equal(delayedPause.acceptsPayload, false);
  assert.deepEqual(flattenOpenRides(cache), []);
  assert.equal(useDriverRequests.getState().paused.has(ride.id), false);
  store.reset();
});

test('the snapshot keeps a newer local object even if it is on another page', () => {
  const local = openRide('ride-1', 2, 30);
  const stale = openRide('ride-1', 1, 20);
  const current = {
    pages: [
      { items: [openRide('other', 1)], nextCursor: 'cursor-2' },
      { items: [local], nextCursor: null },
    ],
    pageParams: [null, 'cursor-2'],
  };
  const reconciled = versionedOpenRidesSnapshot(
    current,
    { items: [stale], nextCursor: null },
    new Set(['ride-1']),
  );

  assert.deepEqual(flattenOpenRides(reconciled), [local]);
});

test('the pool projection keeps a bounded, resettable retention', () => {
  const store = useDriverRequests.getState();
  store.reset();
  for (let index = 0; index < MAX_DRIVER_POOL_CYCLES + 8; index += 1) {
    store.applyPoolEvent({
      rideId: `pool-${index}`,
      poolVersion: 1,
      phase: 'open',
    });
  }

  assert.equal(
    useDriverRequests.getState().poolProjection.size,
    MAX_DRIVER_POOL_CYCLES,
  );
  assert.equal(useDriverRequests.getState().poolProjection.has('pool-0'), false);
  assert.equal(
    useDriverRequests.getState().poolProjection.has(
      `pool-${MAX_DRIVER_POOL_CYCLES + 7}`,
    ),
    true,
  );
  store.reset();
  assert.equal(useDriverRequests.getState().poolProjection.size, 0);
});

for (const outcome of ['markExpired', 'markRejected']) {
  for (const hasPrevious of [true, false]) {
    test(`${outcome} for an older offer preserves a replacement in flight (visible=${hasPrevious})`, () => {
      const store = useDriverRequests.getState();
      store.reset();
      if (hasPrevious) applySentOffer(store, 'ride-1', sentOffer('older'));
      const attempt = store.beginOfferAttempt('ride-1');
      store[outcome]('ride-1', 'older');
      assert.equal(store.markOffered('ride-1', sentOffer('replacement'), 25, attempt), true);
      assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'replacement');
      assert.equal(useDriverRequests.getState().settledOfferIds.has('older'), true);
      store.reset();
    });
  }
}

for (const role of ['driver', 'passenger']) {
  test(`a late mutation from a previous trip cannot overwrite the ${role}'s new active trip`, () => {
    const client = new QueryClient();
    const key = [role + '-active-ride'];
    const current = ride('new-trip', 'accepted');
    client.setQueryData(key, current);
    assert.equal(applyRideMutationResult(client, ride('old-trip', 'completed'), key), false);
    assert.equal(client.getQueryData(key), current);
    client.clear();
  });
}
