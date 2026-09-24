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

test('an earlier HTTP response does not overwrite a snapshot of the same state', () => {
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

test('a local tie keeps the detail that was already applied', () => {
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

test('a truly newer active ride refreshes and keeps its timestamp', () => {
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

test('an initial active ride can seed the detail without faking freshness', () => {
  const client = queryClient();
  const detailKey = ['ride', 'ride-1'];
  const active = ride('searching', 25);

  const applied = copyPassengerActiveRideToDetail(client, active, 150);

  assert.equal(applied, true);
  assert.strictEqual(client.getQueryData(detailKey), active);
  assert.equal(client.getQueryState(detailKey).dataUpdatedAt, 150);
  client.clear();
});

test('an HTTP accepted does not revive a terminal detail even if it resolves later', () => {
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
