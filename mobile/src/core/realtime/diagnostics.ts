/**
 * Evidencia técnica acotada para certificar el WebSocket en un dev build.
 *
 * Solo conserva categorías cerradas y metadatos del transporte. Nunca acepta
 * rutas, identificadores de viaje, tokens, frames ni payloads.
 */

export type RealtimeDiagnosticScope = 'passenger' | 'driver';

export type RealtimeDiagnosticDropReason =
  | 'duplicate'
  | 'stale_stream'
  | 'stale_connection';

export type RealtimeDiagnosticResyncReason =
  | 'event_before_snapshot'
  | 'stream_gap'
  | 'event_id_conflict'
  | 'stale_snapshot'
  | 'invalid_snapshot'
  | 'protocol_mismatch'
  | 'handler_error'
  | 'invalid_frame';

export type RealtimeDiagnosticInput =
  | { kind: 'connected'; scope: RealtimeDiagnosticScope }
  | { kind: 'snapshot_applied'; scope: RealtimeDiagnosticScope }
  | {
      kind: 'closed';
      scope: RealtimeDiagnosticScope;
      code: number;
      wasClean: boolean;
    }
  | {
      kind: 'dropped';
      scope: RealtimeDiagnosticScope;
      reason: RealtimeDiagnosticDropReason;
    }
  | {
      kind: 'resync';
      scope: RealtimeDiagnosticScope;
      reason: RealtimeDiagnosticResyncReason;
    }
  | {
      kind: 'invalid_frame';
      scope: RealtimeDiagnosticScope;
      frameType: string;
      path: string;
    }
  | { kind: 'handler_error'; scope: RealtimeDiagnosticScope };

type RealtimeDiagnosticPayload =
  | RealtimeDiagnosticInput
  | {
      kind: 'invalid_frame';
      scope: RealtimeDiagnosticScope;
      frameType: 'unknown';
      path: '$';
    };

export type RealtimeDiagnosticRecord = RealtimeDiagnosticPayload & {
  sequence: number;
  recordedAt: string;
};

type RealtimeDiagnosticRecorderOptions = {
  capacity?: number;
  enabled?: boolean;
  now?: () => Date;
  sink?: (record: RealtimeDiagnosticRecord) => void;
};

export type RealtimeDiagnosticRecorder = {
  record: (event: RealtimeDiagnosticInput) => void;
  snapshot: () => readonly RealtimeDiagnosticRecord[];
  clear: () => void;
};

const DEFAULT_CAPACITY = 200;
const SAFE_FRAME_TYPE = /^[a-z0-9_]{1,64}$/;
const SAFE_PATH = /^[$a-zA-Z0-9_.?]{1,256}$/;

function sanitizeEvent(
  event: RealtimeDiagnosticInput,
): RealtimeDiagnosticPayload {
  switch (event.kind) {
    case 'connected':
    case 'snapshot_applied':
    case 'handler_error':
      return { kind: event.kind, scope: event.scope };
    case 'closed':
      return {
        kind: event.kind,
        scope: event.scope,
        code:
          Number.isInteger(event.code) && event.code >= 0 && event.code <= 4_999
            ? event.code
            : 0,
        wasClean: event.wasClean === true,
      };
    case 'dropped':
      return {
        kind: 'dropped',
        scope: event.scope,
        reason: event.reason,
      };
    case 'resync':
      return {
        kind: 'resync',
        scope: event.scope,
        reason: event.reason,
      };
    case 'invalid_frame':
      return {
        kind: event.kind,
        scope: event.scope,
        frameType: SAFE_FRAME_TYPE.test(event.frameType)
          ? event.frameType
          : 'unknown',
        path: SAFE_PATH.test(event.path) ? event.path : '$',
      };
  }
}

export function createRealtimeDiagnosticRecorder(
  options: RealtimeDiagnosticRecorderOptions = {},
): RealtimeDiagnosticRecorder {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error('La capacidad del diagnóstico realtime debe ser positiva.');
  }

  const enabled = options.enabled ?? true;
  const now = options.now ?? (() => new Date());
  const records: RealtimeDiagnosticRecord[] = [];
  let sequence = 0;

  return {
    record(event) {
      if (!enabled) return;
      const record = Object.freeze({
        ...sanitizeEvent(event),
        sequence: ++sequence,
        recordedAt: now().toISOString(),
      }) as RealtimeDiagnosticRecord;
      records.push(record);
      if (records.length > capacity) records.splice(0, records.length - capacity);
      try {
        options.sink?.(record);
      } catch {
        // El diagnóstico nunca debe afectar el transporte productivo.
      }
    },
    snapshot() {
      return records.slice();
    },
    clear() {
      records.length = 0;
      sequence = 0;
    },
  };
}

const developmentDiagnosticsEnabled =
  typeof __DEV__ !== 'undefined' && __DEV__;

/** Buffer global consultable desde herramientas de desarrollo y visible en logcat. */
export const realtimeDiagnostics = createRealtimeDiagnosticRecorder({
  enabled: developmentDiagnosticsEnabled,
  sink: (record) => {
    console.info(`[realtime] ${JSON.stringify(record)}`);
  },
});

export function recordRealtimeDiagnostic(
  event: RealtimeDiagnosticInput,
): void {
  realtimeDiagnostics.record(event);
}
