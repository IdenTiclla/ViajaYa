import assert from 'node:assert/strict';
import test from 'node:test';

import {
  driverRealtimeMessageParser,
  isVersionedSocketMessage,
  passengerRealtimeMessageParser,
  toReplayEventMetadata,
  toReplayStreamCheckpoints,
} from '../src/features/rides/data/realtimeSchemas.ts';

const rideId = '00000000-0000-4000-8000-000000000001';
const riderId = '00000000-0000-4000-8000-000000000002';
const driverId = '00000000-0000-4000-8000-000000000003';
const offerId = '00000000-0000-4000-8000-000000000004';
const eventId = '00000000-0000-4000-8000-000000000005';
const batchId = '00000000-0000-4000-8000-000000000006';
const snapshotId = '00000000-0000-4000-8000-000000000007';
const occurredAt = '2026-07-18T12:00:00Z';

function point(name) {
  return {
    latitude: -16.5,
    longitude: -68.15,
    name,
    address: `${name}, La Paz`,
    country_code: 'BO',
  };
}

function offer() {
  return {
    id: offerId,
    ride_id: rideId,
    price: '25.00',
    eta_min: 5,
    status: 'pending',
    driver: {
      id: driverId,
      full_name: 'Conductor Uno',
      rating: 4.8,
      vehicle_type: 'taxi',
      plate: 'ABC-123',
      vehicle_model: 'Sedán',
    },
    created_at: occurredAt,
    expires_at: '2026-07-18T12:00:30Z',
  };
}

function ride() {
  return {
    id: rideId,
    rider_id: riderId,
    rider: {
      id: riderId,
      full_name: 'Pasajero Uno',
      phone: null,
      rating: 4.9,
    },
    status: 'searching',
    paused: false,
    service_type: 'taxi',
    fare: '20.00',
    payment_method: 'cash',
    origin: point('Origen'),
    destination: point('Destino'),
    driver: null,
    accepted_price: null,
    accepted_eta_min: null,
    created_at: occurredAt,
    completed_at: null,
    cancelled_at: null,
  };
}

function openRide() {
  return {
    id: rideId,
    service_type: 'taxi',
    fare: '20.00',
    payment_method: 'cash',
    origin: point('Origen'),
    destination: point('Destino'),
    rider: {
      id: riderId,
      full_name: 'Pasajero Uno',
      rating: 4.9,
      trips_completed: 12,
    },
    pool_version: 1,
    created_at: occurredAt,
  };
}

function eventMetadata(overrides = {}) {
  return {
    schema_version: 2,
    kind: 'event',
    event_id: eventId,
    batch_id: batchId,
    sequence: 0,
    aggregate_type: 'ride',
    aggregate_id: rideId,
    aggregate_version: 7,
    stream: `ride:${rideId}`,
    stream_version: 11,
    occurred_at: occurredAt,
    ...overrides,
  };
}

test('conserva el contrato legacy sin añadir metadatos', () => {
  const result = passengerRealtimeMessageParser.safeParse({
    type: 'offers_snapshot',
    data: [offer()],
  });

  assert.equal(result.success, true);
  assert.equal('schema_version' in result.data, false);
});

test('conserva los mensajes legacy de pasajero y conductor tras el refactor', () => {
  const expired = {
    ride_id: rideId,
    offer_id: offerId,
    driver_id: driverId,
    reason: 'expired',
  };
  const passengerMessages = [
    { type: 'offers_snapshot', data: [offer()] },
    { type: 'offer_created', data: offer() },
    { type: 'offer_withdrawn', data: { driver_id: driverId } },
    { type: 'offer_expired', data: expired },
    { type: 'ride_status', data: ride() },
  ];
  const driverMessages = [
    { type: 'open_rides_snapshot', data: { items: [openRide()], next_cursor: null } },
    { type: 'paused_rides_snapshot', data: [openRide()] },
    { type: 'driver_offers_snapshot', data: [offer()] },
    { type: 'ride_created', data: openRide() },
    {
      type: 'ride_closed',
      data: { ride_id: rideId, pool_version: 1, reason: 'terminal' },
    },
    { type: 'ride_paused', data: { ...openRide(), offer_id: offerId } },
    { type: 'offer_accepted', data: ride() },
    { type: 'offer_expired', data: expired },
    {
      type: 'offer_rejected',
      data: { ride_id: rideId, offer_id: offerId, reason: 'declined' },
    },
    { type: 'driver_active_ride', data: ride() },
    { type: 'offers_withdrawn', data: { ride_ids: [rideId] } },
    { type: 'ride_status', data: ride() },
  ];

  assert.equal(
    passengerMessages.every(
      (message) => passengerRealtimeMessageParser.safeParse(message).success,
    ),
    true,
  );
  assert.equal(
    driverMessages.every(
      (message) => driverRealtimeMessageParser.safeParse(message).success,
    ),
    true,
  );
});

test('ride_closed legacy tolera temporalmente los campos versionados ausentes', () => {
  const result = driverRealtimeMessageParser.safeParse({
    type: 'ride_closed',
    data: { ride_id: rideId },
  });

  assert.equal(result.success, true);
});

test('ride_closed legacy rechaza metadata versionada parcial', () => {
  for (const data of [
    { ride_id: rideId, pool_version: 2 },
    { ride_id: rideId, reason: 'terminal' },
  ]) {
    assert.equal(
      driverRealtimeMessageParser.safeParse({ type: 'ride_closed', data })
        .success,
      false,
    );
  }
});

test('ride_closed v2 exige pool_version y reason aunque legacy los permita omitir', () => {
  const metadata = eventMetadata({ stream: 'pool:taxi' });
  const missingMetadata = driverRealtimeMessageParser.safeParse({
    ...metadata,
    type: 'ride_closed',
    data: { ride_id: rideId },
  });
  const complete = driverRealtimeMessageParser.safeParse({
    ...metadata,
    type: 'ride_closed',
    data: { ride_id: rideId, pool_version: 2, reason: 'paused' },
  });

  assert.equal(missingMetadata.success, false);
  assert.equal(complete.success, true);
});

test('acepta un evento v2 completo y conserva sus campos wire', () => {
  const result = passengerRealtimeMessageParser.safeParse({
    ...eventMetadata(),
    type: 'offer_created',
    data: offer(),
  });

  assert.equal(result.success, true);
  assert.equal(isVersionedSocketMessage(result.data), true);
  assert.equal(result.data.kind, 'event');
  assert.equal(result.data.stream_version, 11);
  assert.equal(result.data.data.id, offerId);

  const metadata = toReplayEventMetadata(result.data);
  assert.equal(metadata.eventId, eventId);
  assert.equal(metadata.batchId, batchId);
  assert.match(metadata.payloadFingerprint, /offer_created/);
});

test('evento v2 correlaciona tipo, agregado, stream y payload', () => {
  const message = { type: 'offer_created', data: offer() };
  const wrongAggregateType = passengerRealtimeMessageParser.safeParse({
    ...eventMetadata({ aggregate_type: 'driver' }),
    ...message,
  });
  const wrongStream = passengerRealtimeMessageParser.safeParse({
    ...eventMetadata({ stream: 'pool:taxi' }),
    ...message,
  });
  const wrongAggregateId = passengerRealtimeMessageParser.safeParse({
    ...eventMetadata({ aggregate_id: riderId }),
    ...message,
  });

  assert.equal(wrongAggregateType.success, false);
  assert.equal(wrongStream.success, false);
  assert.equal(wrongAggregateId.success, false);
});

test('una sola clave v2 obliga validar v2 completo y no cae a legacy', () => {
  const result = passengerRealtimeMessageParser.safeParse({
    event_id: eventId,
    type: 'offer_created',
    data: offer(),
  });

  assert.equal(result.success, false);
});

test('una versión desconocida no puede degradarse a un snapshot legacy válido', () => {
  const result = passengerRealtimeMessageParser.safeParse({
    schema_version: 3,
    type: 'offers_snapshot',
    data: [offer()],
  });

  assert.equal(result.success, false);
});

test('rechaza versiones que JavaScript no puede representar con precisión', () => {
  const result = passengerRealtimeMessageParser.safeParse({
    ...eventMetadata({ stream_version: Number.MAX_SAFE_INTEGER + 1 }),
    type: 'offer_created',
    data: offer(),
  });

  assert.equal(result.success, false);
});

test('ride_snapshot v2 incluye ride y ofertas con su watermark', () => {
  const result = passengerRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'ride_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [{ stream: `ride:${rideId}`, stream_version: 11 }],
    data: { ride: ride(), offers: [offer()] },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.type, 'ride_snapshot');
  assert.equal(result.data.data.ride.id, rideId);
  assert.equal(result.data.data.offers.length, 1);
  assert.deepEqual(toReplayStreamCheckpoints(result.data), [
    { stream: `ride:${rideId}`, version: 11 },
  ]);
});

test('ride_snapshot exige metadata completa y el watermark de su ride', () => {
  const missingCapturedAt = passengerRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'ride_snapshot',
    snapshot_id: snapshotId,
    watermarks: [{ stream: `ride:${rideId}`, stream_version: 11 }],
    data: { ride: ride(), offers: [] },
  });
  const missingRideWatermark = passengerRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'ride_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [{ stream: 'pool:taxi', stream_version: 11 }],
    data: { ride: ride(), offers: [] },
  });

  assert.equal(missingCapturedAt.success, false);
  assert.equal(missingRideWatermark.success, false);
});

test('driver_snapshot v2 unifica el estado y admite active_ride null', () => {
  const result = driverRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'driver_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [
      { stream: 'pool:taxi', stream_version: 4 },
      { stream: 'pool:delivery', stream_version: 2 },
      { stream: `driver:${driverId}`, stream_version: 0 },
    ],
    data: {
      open_rides: { items: [openRide()], next_cursor: null },
      paused_rides: [],
      offers: [offer()],
      active_ride: null,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.type, 'driver_snapshot');
  assert.equal(result.data.data.active_ride, null);
});

test('rechaza snapshots con streams repetidos o estado driver incompleto', () => {
  const duplicatedWatermark = driverRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'driver_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [
      { stream: 'pool:taxi', stream_version: 4 },
      { stream: 'pool:taxi', stream_version: 5 },
    ],
    data: {
      open_rides: { items: [], next_cursor: null },
      paused_rides: [],
      offers: [],
      active_ride: null,
    },
  });
  const missingActiveRide = driverRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'driver_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [
      { stream: 'pool:taxi', stream_version: 4 },
      { stream: 'pool:delivery', stream_version: 2 },
      { stream: `driver:${driverId}`, stream_version: 0 },
    ],
    data: {
      open_rides: { items: [], next_cursor: null },
      paused_rides: [],
      offers: [],
    },
  });

  assert.equal(duplicatedWatermark.success, false);
  assert.equal(missingActiveRide.success, false);
});

test('driver_snapshot exige delivery, pool de vehículo y pertenencia al conductor', () => {
  const missingDelivery = driverRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'driver_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [
      { stream: 'pool:taxi', stream_version: 4 },
      { stream: `driver:${driverId}`, stream_version: 0 },
    ],
    data: {
      open_rides: { items: [], next_cursor: null },
      paused_rides: [],
      offers: [],
      active_ride: null,
    },
  });
  const foreignDriver = driverRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'driver_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [
      { stream: 'pool:taxi', stream_version: 4 },
      { stream: 'pool:delivery', stream_version: 2 },
      {
        stream: 'driver:00000000-0000-4000-8000-000000000099',
        stream_version: 0,
      },
    ],
    data: {
      open_rides: { items: [], next_cursor: null },
      paused_rides: [],
      offers: [offer()],
      active_ride: null,
    },
  });
  const wrongPool = driverRealtimeMessageParser.safeParse({
    schema_version: 2,
    kind: 'snapshot',
    type: 'driver_snapshot',
    snapshot_id: snapshotId,
    captured_at: occurredAt,
    watermarks: [
      { stream: 'pool:taxi', stream_version: 4 },
      { stream: 'pool:delivery', stream_version: 2 },
      { stream: `driver:${driverId}`, stream_version: 0 },
    ],
    data: {
      open_rides: {
        items: [{ ...openRide(), service_type: 'moto' }],
        next_cursor: null,
      },
      paused_rides: [],
      offers: [],
      active_ride: null,
    },
  });

  assert.equal(missingDelivery.success, false);
  assert.equal(foreignDriver.success, false);
  assert.equal(wrongPool.success, false);
});
