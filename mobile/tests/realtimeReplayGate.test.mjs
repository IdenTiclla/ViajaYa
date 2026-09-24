import assert from 'node:assert/strict';
import test from 'node:test';

import { createReplayGate } from '../src/core/realtime/replayGate.ts';

function event(overrides = {}) {
  return {
    eventId: 'event-1',
    batchId: 'batch-1',
    correlationId: 'correlation-1',
    sequence: 0,
    eventType: 'offer_created',
    aggregateType: 'ride',
    aggregateId: 'ride-1',
    aggregateVersion: 1,
    stream: 'ride:ride-1',
    streamVersion: 11,
    occurredAt: '2026-07-18T20:00:00Z',
    payloadFingerprint: '{"data":{"id":"offer-1"},"type":"offer_created"}',
    ...overrides,
  };
}

function establish(gate, stream = 'ride:ride-1', version = 10) {
  const decision = gate.decideSnapshot(
    [{ stream, version }],
    [stream],
  );
  assert.equal(decision.kind, 'apply');
  gate.commit(decision.ticket);
}

test('requires a snapshot before the first versioned event', () => {
  const gate = createReplayGate();

  assert.deepEqual(gate.decideEvent(event()), {
    kind: 'resync',
    reason: 'event_before_snapshot',
  });
});

test('only advances cursors after confirming the ticket', () => {
  const gate = createReplayGate();
  establish(gate);

  const first = gate.decideEvent(event());
  assert.equal(first.kind, 'apply');
  assert.equal(gate.state().streams.get('ride:ride-1'), 10);

  // Simulates a failed handler: without a commit, the same event can still be processed.
  const retry = gate.decideEvent(event());
  assert.equal(retry.kind, 'apply');
  gate.commit(retry.ticket);

  assert.equal(gate.state().streams.get('ride:ride-1'), 11);
  assert.equal(gate.state().aggregates.get('ride:ride-1'), 1);
});

test('an exact retry does not repeat the mutation', () => {
  const gate = createReplayGate();
  establish(gate);
  const first = gate.decideEvent(event());
  assert.equal(first.kind, 'apply');
  gate.commit(first.ticket);

  assert.deepEqual(gate.decideEvent(event()), {
    kind: 'drop',
    reason: 'duplicate',
    ticket: null,
  });
});

test('a stream gap forces a resnapshot and does not advance the cursor', () => {
  const gate = createReplayGate();
  establish(gate);

  assert.deepEqual(gate.decideEvent(event({ streamVersion: 12 })), {
    kind: 'resync',
    reason: 'stream_gap',
  });
  assert.equal(gate.state().streams.get('ride:ride-1'), 10);
});

test('an old aggregate event on another stream keeps its delta', () => {
  const gate = createReplayGate();
  establish(gate, 'ride:ride-1', 10);
  establish(gate, 'driver:driver-1', 20);

  const applied = gate.decideEvent(event());
  assert.equal(applied.kind, 'apply');
  gate.commit(applied.ticket);

  const fanout = gate.decideEvent(
    event({
      eventId: 'event-2',
      batchId: 'batch-2',
      correlationId: 'correlation-2',
      eventType: 'ride_paused',
      stream: 'driver:driver-1',
      streamVersion: 21,
    }),
  );
  assert.equal(fanout.kind, 'apply');
  gate.commit(fanout.ticket);

  assert.equal(gate.state().streams.get('driver:driver-1'), 21);
});

test('the same event_id on another stream contradicts the per-delivery contract', () => {
  const gate = createReplayGate();
  establish(gate, 'ride:ride-1', 10);
  establish(gate, 'driver:driver-1', 20);

  const first = gate.decideEvent(event());
  assert.equal(first.kind, 'apply');
  gate.commit(first.ticket);

  const duplicateFanout = gate.decideEvent(
    event({ stream: 'driver:driver-1', streamVersion: 21 }),
  );
  assert.deepEqual(duplicateFanout, {
    kind: 'resync',
    reason: 'event_id_conflict',
  });
  assert.equal(gate.state().streams.get('driver:driver-1'), 20);
});

test('an old snapshot is rejected and a new one can skip positions', () => {
  const gate = createReplayGate();
  establish(gate, 'ride:ride-1', 12);

  assert.deepEqual(
    gate.decideSnapshot(
      [{ stream: 'ride:ride-1', version: 11 }],
      ['ride:ride-1'],
    ),
    { kind: 'resync', reason: 'stale_snapshot' },
  );

  const newer = gate.decideSnapshot(
    [{ stream: 'ride:ride-1', version: 15 }],
    ['ride:ride-1'],
  );
  assert.equal(newer.kind, 'apply');
  gate.commit(newer.ticket);
  assert.equal(gate.state().streams.get('ride:ride-1'), 15);
  assert.equal(
    gate.decideEvent(event({ eventId: 'event-14', streamVersion: 14 })).kind,
    'drop',
  );
  assert.equal(
    gate.decideEvent(event({ eventId: 'event-16', streamVersion: 16 })).kind,
    'apply',
  );
});

test('an incomplete snapshot and a contradictory event_id force a resync', () => {
  const gate = createReplayGate();
  assert.deepEqual(
    gate.decideSnapshot(
      [{ stream: 'pool:taxi', version: 3 }],
      ['pool:taxi', 'driver:driver-1'],
    ),
    { kind: 'resync', reason: 'invalid_snapshot' },
  );

  establish(gate);
  const first = gate.decideEvent(event());
  assert.equal(first.kind, 'apply');
  gate.commit(first.ticket);
  assert.deepEqual(
    gate.decideEvent(
      event({
        aggregateVersion: 2,
        streamVersion: 12,
      }),
    ),
    { kind: 'resync', reason: 'event_id_conflict' },
  );
});

test('the same event_id with another payload forces a resync', () => {
  const gate = createReplayGate();
  establish(gate);
  const first = gate.decideEvent(event());
  assert.equal(first.kind, 'apply');
  gate.commit(first.ticket);

  assert.deepEqual(
    gate.decideEvent(
      event({
        streamVersion: 12,
        payloadFingerprint: '{"data":{"id":"offer-2"},"type":"offer_created"}',
      }),
    ),
    { kind: 'resync', reason: 'event_id_conflict' },
  );
});

test('the diagnostic correlation does not contradict a retry of the same event', () => {
  const gate = createReplayGate();
  establish(gate);
  const first = gate.decideEvent(event());
  assert.equal(first.kind, 'apply');
  gate.commit(first.ticket);

  assert.deepEqual(
    gate.decideEvent(event({ correlationId: 'otra' })),
    { kind: 'drop', reason: 'duplicate', ticket: null },
  );
});

test('reset clears watermarks and deduplication when the session changes', () => {
  const gate = createReplayGate();
  establish(gate);
  const first = gate.decideEvent(event());
  assert.equal(first.kind, 'apply');
  gate.commit(first.ticket);

  gate.reset();

  assert.equal(gate.state().streams.size, 0);
  assert.equal(gate.state().aggregates.size, 0);
  assert.equal(gate.state().rememberedEventIds, 0);
});

test('abort consumes the ticket without advancing cursors', () => {
  const gate = createReplayGate();
  establish(gate);
  const decision = gate.decideEvent(event());
  assert.equal(decision.kind, 'apply');

  gate.abort(decision.ticket);

  assert.equal(gate.state().streams.get('ride:ride-1'), 10);
  assert.throws(() => gate.commit(decision.ticket), /consumido/);
  assert.throws(() => gate.abort(decision.ticket), /consumido/);
});

test('reset invalidates pending tickets from the previous epoch', () => {
  const gate = createReplayGate();
  const decision = gate.decideSnapshot(
    [{ stream: 'ride:ride-1', version: 10 }],
    ['ride:ride-1'],
  );
  assert.equal(decision.kind, 'apply');

  gate.reset();

  assert.throws(() => gate.commit(decision.ticket), /consumido/);
});

test('snapshot rejects additional streams even if it includes the required ones', () => {
  const gate = createReplayGate();

  assert.deepEqual(
    gate.decideSnapshot(
      [
        { stream: 'ride:ride-1', version: 10 },
        { stream: 'driver:driver-1', version: 3 },
      ],
      ['ride:ride-1'],
    ),
    { kind: 'resync', reason: 'invalid_snapshot' },
  );
});
