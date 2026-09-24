import assert from 'node:assert/strict';
import test from 'node:test';

import { createReplayGate } from '../src/core/realtime/replayGate.ts';
import { createRealtimeReplayConsumer } from '../src/features/rides/application/realtimeReplayConsumer.ts';

function snapshot(version = 10) {
  return { protocol: 'v2', kind: 'snapshot', version };
}

function event(version = 11, eventId = `event-${version}`) {
  return { protocol: 'v2', kind: 'event', version, eventId };
}

function legacySnapshot(complete = true) {
  return { protocol: 'legacy', kind: 'snapshot', complete };
}

function legacyEvent() {
  return { protocol: 'legacy', kind: 'event' };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup({ failEvent = false } = {}) {
  const gate = createReplayGate();
  const mutations = [];
  const resyncs = [];
  const consumer = createRealtimeReplayConsumer({
    gate,
    classify(message) {
      if (message.protocol === 'legacy') {
        return message.kind === 'snapshot'
          ? {
              protocol: 'legacy',
              kind: 'snapshot',
              completesHandshake: message.complete,
            }
          : { protocol: 'legacy', kind: 'event' };
      }
      return message.kind === 'snapshot'
        ? {
            protocol: 'v2',
            kind: 'snapshot',
            checkpoints: [{ stream: 'ride:ride-1', version: message.version }],
            requiredStreams: ['ride:ride-1'],
          }
        : {
            protocol: 'v2',
            kind: 'event',
            metadata: {
              eventId: message.eventId,
              batchId: `batch-${message.eventId}`,
              correlationId: `correlation-${message.eventId}`,
              sequence: 0,
              eventType: 'offer_created',
              aggregateType: 'ride',
              aggregateId: 'ride-1',
              aggregateVersion: message.version,
              stream: 'ride:ride-1',
              streamVersion: message.version,
              occurredAt: '2026-07-22T12:00:00Z',
              payloadFingerprint: `payload-${message.eventId}`,
            },
          };
    },
    async applyLegacy(message) {
      mutations.push(`legacy-${message.kind}`);
    },
    async applySnapshot(message) {
      mutations.push(`snapshot-${message.version}`);
    },
    async applyEvent(message) {
      if (failEvent) throw new Error('handler');
      mutations.push(`event-${message.version}`);
    },
    onResync(reason) {
      resyncs.push(reason);
    },
  });
  consumer.beginConnection();
  return { consumer, gate, mutations, resyncs };
}

test('snapshot, delta and duplicate mutate only once', async () => {
  const { consumer, mutations, resyncs } = setup();

  assert.deepEqual(await consumer.consume(snapshot()), { kind: 'applied' });
  assert.deepEqual(await consumer.consume(event()), { kind: 'applied' });
  assert.deepEqual(await consumer.consume(event()), {
    kind: 'dropped',
    reason: 'duplicate',
  });

  assert.deepEqual(mutations, ['snapshot-10', 'event-11']);
  assert.deepEqual(resyncs, []);
});

test('a gap does not mutate and requests a resync keeping the cursor', async () => {
  const { consumer, gate, mutations, resyncs } = setup();
  await consumer.consume(snapshot());

  assert.deepEqual(await consumer.consume(event(12)), {
    kind: 'resync',
    reason: 'stream_gap',
  });
  assert.deepEqual(mutations, ['snapshot-10']);
  assert.deepEqual(resyncs, ['stream_gap']);
  assert.equal(gate.state().streams.get('ride:ride-1'), 10);
});

test('a handler failure aborts the ticket and forces a resync', async () => {
  const { consumer, gate, mutations, resyncs } = setup({ failEvent: true });
  await consumer.consume(snapshot());

  assert.deepEqual(await consumer.consume(event()), {
    kind: 'resync',
    reason: 'handler_error',
  });
  assert.deepEqual(mutations, ['snapshot-10']);
  assert.deepEqual(resyncs, ['handler_error']);
  assert.equal(gate.state().streams.get('ride:ride-1'), 10);
});

test('runs the visual effects only after confirming the cursor', async () => {
  const gate = createReplayGate();
  const observed = [];
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
              streamVersion: 11,
              occurredAt: '2026-07-22T12:00:00Z',
              payloadFingerprint: 'payload-11',
            },
          };
    },
    async applyLegacy() {},
    async applySnapshot() {},
    async applyEvent() {
      return () => observed.push(gate.state().streams.get('ride:ride-1'));
    },
    onResync() {},
  });
  consumer.beginConnection();

  await consumer.consume({ kind: 'snapshot' });
  await consumer.consume({ kind: 'event' });

  assert.deepEqual(observed, [11]);
});

test('a v2 event before the snapshot forces a resync', async () => {
  const { consumer, mutations, resyncs } = setup();

  assert.deepEqual(await consumer.consume(event(1)), {
    kind: 'resync',
    reason: 'event_before_snapshot',
  });
  assert.deepEqual(mutations, []);
  assert.deepEqual(resyncs, ['event_before_snapshot']);
});

test('mixing protocols in one connection does not duplicate mutations', async () => {
  const { consumer, mutations, resyncs } = setup();
  await consumer.consume(legacySnapshot());
  await consumer.consume(legacyEvent());

  assert.deepEqual(await consumer.consume(snapshot()), {
    kind: 'resync',
    reason: 'protocol_mismatch',
  });
  assert.deepEqual(mutations, ['legacy-snapshot', 'legacy-event']);
  assert.deepEqual(resyncs, ['protocol_mismatch']);
});

test('a new connection can go back from v2 to legacy during a rollback', async () => {
  const { consumer, mutations, resyncs } = setup();
  await consumer.consume(snapshot());
  consumer.beginConnection();

  assert.deepEqual(await consumer.consume(legacySnapshot()), {
    kind: 'applied',
  });
  assert.deepEqual(mutations, ['snapshot-10', 'legacy-snapshot']);
  assert.deepEqual(resyncs, []);
});

test('a new connection invalidates the previous snapshot while its handler waits', async () => {
  const gate = createReplayGate();
  const release = deferred();
  const started = deferred();
  const effects = [];
  const consumer = createRealtimeReplayConsumer({
    gate,
    classify() {
      return {
        protocol: 'v2',
        kind: 'snapshot',
        checkpoints: [{ stream: 'ride:ride-1', version: 10 }],
        requiredStreams: ['ride:ride-1'],
      };
    },
    async applyLegacy() {},
    async applySnapshot() {
      started.resolve();
      await release.promise;
      return () => effects.push('snapshot');
    },
    async applyEvent() {},
    onResync() {},
  });
  const oldConnection = consumer.beginConnection();

  const applying = consumer.consume({ kind: 'snapshot' }, oldConnection);
  await started.promise;
  const newConnection = consumer.beginConnection();
  release.resolve();

  assert.deepEqual(await applying, {
    kind: 'dropped',
    reason: 'stale_connection',
  });
  assert.equal(oldConnection.isCurrent(), false);
  assert.equal(newConnection.isCurrent(), true);
  assert.equal(consumer.protocol(), 'awaiting_snapshot');
  assert.equal(gate.state().streams.has('ride:ride-1'), false);
  assert.deepEqual(effects, []);
});

test('invalidating during an event aborts its ticket and suppresses the effect', async () => {
  const gate = createReplayGate();
  const release = deferred();
  const started = deferred();
  const effects = [];
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
              streamVersion: 11,
              occurredAt: '2026-07-22T12:00:00Z',
              payloadFingerprint: 'payload-11',
            },
          };
    },
    async applyLegacy() {},
    async applySnapshot() {},
    async applyEvent() {
      started.resolve();
      await release.promise;
      return () => effects.push('event');
    },
    onResync() {},
  });
  const connection = consumer.beginConnection();
  await consumer.consume({ kind: 'snapshot' }, connection);

  const applying = consumer.consume({ kind: 'event' }, connection);
  await started.promise;
  consumer.invalidateConnection();
  release.resolve();

  assert.deepEqual(await applying, {
    kind: 'dropped',
    reason: 'stale_connection',
  });
  assert.equal(connection.isCurrent(), false);
  assert.equal(consumer.protocol(), 'awaiting_snapshot');
  assert.equal(gate.state().streams.get('ride:ride-1'), 10);
  assert.deepEqual(effects, []);
});

test('a stale external guard neither confirms nor emits effects', async () => {
  const gate = createReplayGate();
  const release = deferred();
  const started = deferred();
  const effects = [];
  let transportCurrent = true;
  const consumer = createRealtimeReplayConsumer({
    gate,
    classify() {
      return {
        protocol: 'v2',
        kind: 'snapshot',
        checkpoints: [{ stream: 'ride:ride-1', version: 10 }],
        requiredStreams: ['ride:ride-1'],
      };
    },
    async applyLegacy() {},
    async applySnapshot() {
      started.resolve();
      await release.promise;
      return () => effects.push('snapshot');
    },
    async applyEvent() {},
    onResync() {},
  });
  consumer.beginConnection();

  const applying = consumer.consume(
    { kind: 'snapshot' },
    { isCurrent: () => transportCurrent },
  );
  await started.promise;
  transportCurrent = false;
  release.resolve();

  assert.deepEqual(await applying, {
    kind: 'dropped',
    reason: 'stale_connection',
  });
  assert.equal(gate.state().streams.has('ride:ride-1'), false);
  assert.deepEqual(effects, []);
});

test('an old failing handler does not invalidate the new connection', async () => {
  const gate = createReplayGate();
  const release = deferred();
  const started = deferred();
  const resyncs = [];
  const consumer = createRealtimeReplayConsumer({
    gate,
    classify() {
      return {
        protocol: 'v2',
        kind: 'snapshot',
        checkpoints: [{ stream: 'ride:ride-1', version: 10 }],
        requiredStreams: ['ride:ride-1'],
      };
    },
    async applyLegacy() {},
    async applySnapshot() {
      started.resolve();
      await release.promise;
      throw new Error('late failure');
    },
    async applyEvent() {},
    onResync(reason) {
      resyncs.push(reason);
    },
  });
  const oldConnection = consumer.beginConnection();

  const applying = consumer.consume({ kind: 'snapshot' }, oldConnection);
  await started.promise;
  const newConnection = consumer.beginConnection();
  release.resolve();

  assert.deepEqual(await applying, {
    kind: 'dropped',
    reason: 'stale_connection',
  });
  assert.equal(newConnection.isCurrent(), true);
  assert.equal(consumer.protocol(), 'awaiting_snapshot');
  assert.deepEqual(resyncs, []);
});

test('a stale legacy snapshot does not change the protocol or emit an effect either', async () => {
  const gate = createReplayGate();
  const release = deferred();
  const started = deferred();
  const effects = [];
  let transportCurrent = true;
  const consumer = createRealtimeReplayConsumer({
    gate,
    classify() {
      return {
        protocol: 'legacy',
        kind: 'snapshot',
        completesHandshake: true,
      };
    },
    async applyLegacy() {
      started.resolve();
      await release.promise;
      return () => effects.push('legacy');
    },
    async applySnapshot() {},
    async applyEvent() {},
    onResync() {},
  });
  consumer.beginConnection();

  const applying = consumer.consume(
    { kind: 'snapshot' },
    { isCurrent: () => transportCurrent },
  );
  await started.promise;
  transportCurrent = false;
  release.resolve();

  assert.deepEqual(await applying, {
    kind: 'dropped',
    reason: 'stale_connection',
  });
  assert.equal(consumer.protocol(), 'awaiting_snapshot');
  assert.deepEqual(effects, []);
});
