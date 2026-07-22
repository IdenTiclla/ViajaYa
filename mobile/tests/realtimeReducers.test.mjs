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

test('el snapshot reemplaza las ofertas anteriores', () => {
  const incoming = [offer('new', 'driver-new')];
  const result = reducePassengerOffers([offer('old', 'driver-old')], {
    type: 'snapshot',
    offers: incoming,
  });

  assert.deepEqual(result.offers, incoming);
  assert.notStrictEqual(result.offers, incoming);
  assert.equal(result.notice, null);
});

test('un evento duplicado actualiza sin repetir la notificación', () => {
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

test('una oferta nueva reemplaza la anterior del mismo conductor', () => {
  const retained = offer('other', 'driver-2');
  const replacement = offer('new', 'driver-1', 25);
  const result = reducePassengerOffers(
    [offer('old', 'driver-1'), retained],
    { type: 'created', offer: replacement },
  );

  assert.deepEqual(result.offers, [replacement, retained]);
  assert.deepEqual(result.notice, { kind: 'received', offer: replacement });
});

test('un retiro superseded conserva la referencia para evitar parpadeo', () => {
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

test('un retiro por id elimina únicamente la oferta indicada', () => {
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

test('un retiro sin id elimina la oferta por conductor', () => {
  const removed = offer('offer-1', 'driver-1');
  const retained = offer('offer-2', 'driver-2');
  const result = reducePassengerOffers([removed, retained], {
    type: 'withdrawn',
    driverId: 'driver-1',
  });

  assert.deepEqual(result.offers, [retained]);
  assert.deepEqual(result.notice, { kind: 'withdrawn', offer: removed });
});

test('una expiración elimina por id y describe la notificación', () => {
  const expired = offer('offer-1', 'driver-1');
  const retained = offer('offer-2', 'driver-2');
  const result = reducePassengerOffers([expired, retained], {
    type: 'expired',
    offerId: 'offer-1',
  });

  assert.deepEqual(result.offers, [retained]);
  assert.deepEqual(result.notice, { kind: 'expired', offer: expired });
});

test('una expiración atrasada no elimina la oferta nueva del mismo conductor', () => {
  const replacement = offer('offer-2', 'driver-1');
  const result = reducePassengerOffers([replacement], {
    type: 'expired',
    offerId: 'offer-1',
  });

  assert.deepEqual(result.offers, [replacement]);
  assert.equal(result.notice, null);
});

test('un ride terminal no retrocede por un evento atrasado', () => {
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

test('los estados de ride avanzan de forma monótona y permiten refrescarse', () => {
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

test('los estados de ride rechazan retrocesos no terminales', () => {
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

test('cancelled solo se acepta antes de iniciar el viaje', () => {
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

test('una respuesta HTTP accepted atrasada no reemplaza el cancelled recibido por WS', async () => {
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

  // El WebSocket se adelanta mientras la petición HTTP continúa pendiente.
  const cancelled = ride('ride-1', 'cancelled');
  queryClient.setQueryData(detailKey, cancelled);
  queryClient.setQueryData(activeKey, null);
  resolveHttp(ride('ride-1', 'accepted'));
  await applyHttpResponse;

  assert.deepEqual(queryClient.getQueryData(detailKey), cancelled);
  assert.equal(queryClient.getQueryData(activeKey), null);
  queryClient.clear();
});

test('una respuesta HTTP normal avanza el ride no terminal', () => {
  const accepted = ride('ride-1', 'accepted');
  const reduction = reduceRideMutationResult(
    ride('ride-1', 'searching'),
    accepted,
  );

  assert.equal(reduction.applied, true);
  assert.strictEqual(reduction.ride, accepted);
});

test('una respuesta HTTP atrasada respeta la caché activa más adelantada', () => {
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

test('una respuesta HTTP del mismo estado terminal puede refrescar sus datos', () => {
  const cancelled = ride('ride-1', 'cancelled');
  const reduction = reduceRideMutationResult(
    ride('ride-1', 'cancelled'),
    cancelled,
  );

  assert.equal(reduction.applied, true);
  assert.strictEqual(reduction.ride, cancelled);
});

test('el activo del pasajero se recupera, actualiza y limpia al terminar', () => {
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

test('el activo del conductor solo cambia cuando coincide el ride', () => {
  const current = ride('ride-1', 'accepted');
  const arriving = ride('ride-1', 'arriving');
  const other = ride('ride-2', 'arriving');

  assert.deepEqual(reduceDriverActiveRide(current, arriving), arriving);
  assert.strictEqual(reduceDriverActiveRide(current, other), current);
  assert.equal(reduceDriverActiveRide(null, arriving), null);
});

test('los reducers activos tampoco permiten retrocesos', () => {
  const inProgress = ride('ride-1', 'in_progress');
  const arriving = ride('ride-1', 'arriving');

  assert.strictEqual(
    reducePassengerActiveRide(inProgress, arriving),
    inProgress,
  );
  assert.strictEqual(reduceDriverActiveRide(inProgress, arriving), inProgress);
});

test('la expiración del conductor compara offerId y es idempotente', () => {
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

test('el retiro resumido elimina solo los rides indicados y tolera duplicados', () => {
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

test('un rechazo WS anterior al HTTP impide revivir la misma oferta', () => {
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

test('una reoferta legítima no hereda el tombstone de la oferta anterior', () => {
  const store = useDriverRequests.getState();
  store.reset();
  store.markRejected('ride-1', 'offer-1');

  assert.equal(applySentOffer(store, 'ride-1', sentOffer('offer-2')), true);
  assert.equal(useDriverRequests.getState().rejected.has('ride-1'), false);
  assert.equal(store.markRejected('ride-1', 'offer-1'), false);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-2');
  store.reset();
});

test('expiración y pausa exactas bloquean su respuesta HTTP tardía', () => {
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

test('un ride asignado, tomado o cancelado bloquea cualquier oferta tardía', () => {
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

test('ride_closed y offer_rejected convergen en cualquier orden', () => {
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

test('el snapshot PENDING corrige una expiración local por reloj adelantado', () => {
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
      // Simula reloj del dispositivo adelantado respecto al servidor.
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

test('una pausa de snapshot invalida el HTTP incluso después de reanudar', () => {
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

test('una pausa atrasada sella su oferta sin degradar la generación nueva', () => {
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

test('el retiro voluntario de A no elimina una oferta B posterior', () => {
  const store = useDriverRequests.getState();
  store.reset();
  applySentOffer(store, 'ride-1', sentOffer('offer-a'));
  applySentOffer(store, 'ride-1', sentOffer('offer-b'));

  assert.equal(store.markWithdrawn('ride-1', 'offer-a'), false);
  assert.equal(useDriverRequests.getState().offered['ride-1'].offerId, 'offer-b');
  assert.equal(useDriverRequests.getState().settledOfferIds.has('offer-a'), true);
  store.reset();
});

test('el retiro exacto de A no invalida una reoferta B en vuelo', () => {
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

test('offers_withdrawn exacto hace CAS por offer_id y sus duplicados son idempotentes', () => {
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

test('dos intentos solapados solo aplican la respuesta más nueva', () => {
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

test('pasar offline invalida respuestas de oferta todavía pendientes', () => {
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

test('los guards históricos mantienen una retención acotada', () => {
  const store = useDriverRequests.getState();
  store.reset();
  for (let index = 0; index < 520; index += 1) {
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

test('close y pause de la misma versión convergen sin importar el orden', () => {
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

test('un cierre terminal domina una pausa de la misma versión', () => {
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

test('un created duplicado no reabre un ciclo cerrado', () => {
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

test('cierres y pausas atrasados no degradan una publicación nueva', () => {
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

test('solo una versión abierta mayor limpia desenlaces del conductor', () => {
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

test('solo un close aplicado retira la oferta e invalida su intento', () => {
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

test('terminal elimina una tarjeta pausada y una pausa tardía no la revive', () => {
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

test('el snapshot conserva un objeto local más nuevo aunque esté en otra página', () => {
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

test('la proyección del pool conserva una retención acotada y reiniciable', () => {
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
