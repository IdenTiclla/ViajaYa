import assert from 'node:assert/strict';
import test from 'node:test';

import { createRealtimeDiagnosticRecorder } from '../src/core/realtime/diagnostics.ts';

test('keeps a bounded buffer with sanitized metadata', () => {
  const emitted = [];
  const recorder = createRealtimeDiagnosticRecorder({
    capacity: 2,
    now: () => new Date('2026-07-22T20:00:00.000Z'),
    sink: (record) => emitted.push(record),
  });

  recorder.record({ kind: 'connected', scope: 'passenger' });
  recorder.record({
    kind: 'invalid_frame',
    scope: 'passenger',
    frameType: 'ride_status',
    path: 'data.status',
    payload: { token: 'must not be kept' },
  });
  recorder.record({
    kind: 'closed',
    scope: 'passenger',
    code: 1012,
    wasClean: false,
    reason: 'untrusted remote text',
  });

  assert.equal(emitted.length, 3);
  assert.deepEqual(recorder.snapshot(), [
    {
      kind: 'invalid_frame',
      scope: 'passenger',
      frameType: 'ride_status',
      path: 'data.status',
      sequence: 2,
      recordedAt: '2026-07-22T20:00:00.000Z',
    },
    {
      kind: 'closed',
      scope: 'passenger',
      code: 1012,
      wasClean: false,
      sequence: 3,
      recordedAt: '2026-07-22T20:00:00.000Z',
    },
  ]);
  assert.equal('payload' in emitted[1], false);
  assert.equal('reason' in emitted[2], false);
});

test('normalizes invalid metadata and never propagates sink failures', () => {
  const recorder = createRealtimeDiagnosticRecorder({
    sink: () => {
      throw new Error('sink');
    },
  });

  assert.doesNotThrow(() => {
    recorder.record({
      kind: 'invalid_frame',
      scope: 'driver',
      frameType: 'dato privado',
      path: 'ruta/[privada]',
    });
    recorder.record({
      kind: 'closed',
      scope: 'driver',
      code: 99_999,
      wasClean: true,
    });
  });

  assert.deepEqual(
    recorder.snapshot().map(({ recordedAt: _recordedAt, ...record }) => record),
    [
      {
        kind: 'invalid_frame',
        scope: 'driver',
        frameType: 'unknown',
        path: '$',
        sequence: 1,
      },
      {
        kind: 'closed',
        scope: 'driver',
        code: 0,
        wasClean: true,
        sequence: 2,
      },
    ],
  );
});

test('the disabled observer neither keeps nor emits events', () => {
  let emitted = 0;
  const recorder = createRealtimeDiagnosticRecorder({
    enabled: false,
    sink: () => {
      emitted += 1;
    },
  });

  recorder.record({
    kind: 'dropped',
    scope: 'driver',
    reason: 'duplicate',
  });

  assert.deepEqual(recorder.snapshot(), []);
  assert.equal(emitted, 0);
});
