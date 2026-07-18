import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

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
