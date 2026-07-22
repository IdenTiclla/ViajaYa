import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import { copyPassengerActiveRideToDetail } from '../src/features/rides/application/rideStatusReducer.ts';

function ride(status = 'searching', fare = 20) {
  const place = {
    coordinates: { latitude: -16.5, longitude: -68.15 },
    name: 'Lugar',
    address: 'Dirección',
    countryCode: 'BO',
  };
  return {
    id: 'ride-1',
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
    fare,
    origin: place,
    destination: place,
    driver: null,
    acceptedPrice: null,
    acceptedEtaMin: null,
  };
}

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

test('un HTTP anterior no pisa un snapshot del mismo estado', () => {
  const client = queryClient();
  const detailKey = ['ride', 'ride-1'];
  const snapshot = { ...ride('searching', 30), paused: true };
  client.setQueryData(detailKey, snapshot, { updatedAt: 200 });

  const applied = copyPassengerActiveRideToDetail(
    client,
    ride('searching', 20),
    100,
  );

  assert.equal(applied, false);
  assert.deepEqual(client.getQueryData(detailKey), snapshot);
  assert.equal(client.getQueryState(detailKey).dataUpdatedAt, 200);
  client.clear();
});

test('un empate local conserva el detalle que ya estaba aplicado', () => {
  const client = queryClient();
  const detailKey = ['ride', 'ride-1'];
  const snapshot = ride('searching', 30);
  client.setQueryData(detailKey, snapshot, { updatedAt: 200 });

  const applied = copyPassengerActiveRideToDetail(
    client,
    ride('searching', 20),
    200,
  );

  assert.equal(applied, false);
  assert.strictEqual(client.getQueryData(detailKey), snapshot);
  client.clear();
});

test('un activo realmente más nuevo refresca y conserva su timestamp', () => {
  const client = queryClient();
  const detailKey = ['ride', 'ride-1'];
  client.setQueryData(detailKey, ride('searching', 20), { updatedAt: 100 });
  const fresh = ride('searching', 30);

  const applied = copyPassengerActiveRideToDetail(client, fresh, 200);

  assert.equal(applied, true);
  assert.deepEqual(client.getQueryData(detailKey), fresh);
  assert.equal(client.getQueryState(detailKey).dataUpdatedAt, 200);
  client.clear();
});

test('un activo inicial puede sembrar el detalle sin fabricar frescura', () => {
  const client = queryClient();
  const detailKey = ['ride', 'ride-1'];
  const active = ride('searching', 25);

  const applied = copyPassengerActiveRideToDetail(client, active, 150);

  assert.equal(applied, true);
  assert.strictEqual(client.getQueryData(detailKey), active);
  assert.equal(client.getQueryState(detailKey).dataUpdatedAt, 150);
  client.clear();
});

test('un HTTP accepted no revive un detalle terminal aunque resuelva después', () => {
  const client = queryClient();
  const detailKey = ['ride', 'ride-1'];
  const cancelled = ride('cancelled', 20);
  client.setQueryData(detailKey, cancelled, { updatedAt: 100 });

  const applied = copyPassengerActiveRideToDetail(
    client,
    ride('accepted', 20),
    200,
  );

  assert.equal(applied, false);
  assert.strictEqual(client.getQueryData(detailKey), cancelled);
  assert.equal(client.getQueryState(detailKey).dataUpdatedAt, 100);
  client.clear();
});
