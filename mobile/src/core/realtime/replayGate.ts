/**
 * Gate puro para entrega realtime al menos una vez.
 *
 * No muta cursores al decidir: el consumidor confirma el ticket únicamente
 * después de actualizar React Query/Zustand con éxito. Así un handler fallido
 * puede procesar de nuevo el mismo evento al reconectar.
 */

export type RealtimeEventMetadata = {
  eventId: string;
  batchId: string;
  sequence: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  stream: string;
  streamVersion: number;
  occurredAt: string;
  payloadFingerprint: string;
};

export type StreamCheckpoint = {
  stream: string;
  version: number;
};

export type ReplayDropReason =
  | 'duplicate'
  | 'stale_stream';

export type ReplayResyncReason =
  | 'event_before_snapshot'
  | 'stream_gap'
  | 'event_id_conflict'
  | 'stale_snapshot'
  | 'invalid_snapshot';

type CursorUpdate = {
  key: string;
  expected: number | undefined;
  next: number;
};

export type ReplayTicket = {
  readonly id: symbol;
  readonly owner: symbol;
  readonly streamUpdates: readonly CursorUpdate[];
  readonly aggregateUpdates: readonly CursorUpdate[];
  readonly event:
    | { id: string; fingerprint: string; seenAt: number }
    | null;
  readonly epoch: number;
  committed: boolean;
  aborted: boolean;
};

export type ReplayDecision =
  | { kind: 'apply'; ticket: ReplayTicket }
  | { kind: 'drop'; reason: ReplayDropReason; ticket: ReplayTicket | null }
  | { kind: 'resync'; reason: ReplayResyncReason };

export type ReplayGateState = {
  streams: ReadonlyMap<string, number>;
  aggregates: ReadonlyMap<string, number>;
  rememberedEventIds: number;
};

export type ReplayGate = {
  decideEvent: (metadata: RealtimeEventMetadata | null) => ReplayDecision;
  decideSnapshot: (
    checkpoints: readonly StreamCheckpoint[],
    requiredStreams: readonly string[],
  ) => ReplayDecision;
  commit: (ticket: ReplayTicket) => void;
  abort: (ticket: ReplayTicket) => void;
  reset: () => void;
  state: () => ReplayGateState;
};

type RememberedEvent = {
  fingerprint: string;
  seenAt: number;
};

type ReplayGateOptions = {
  maxEventIds?: number;
  eventTtlMs?: number;
  now?: () => number;
};

const DEFAULT_MAX_EVENT_IDS = 2_048;
const DEFAULT_EVENT_TTL_MS = 30 * 60 * 1_000;

function aggregateKey(metadata: RealtimeEventMetadata): string {
  return `${metadata.aggregateType}:${metadata.aggregateId}`;
}

function eventFingerprint(metadata: RealtimeEventMetadata): string {
  return JSON.stringify([
    metadata.batchId,
    metadata.sequence,
    metadata.eventType,
    metadata.aggregateType,
    metadata.aggregateId,
    metadata.aggregateVersion,
    metadata.stream,
    metadata.streamVersion,
    metadata.occurredAt,
    metadata.payloadFingerprint,
  ]);
}

export function createReplayGate(options: ReplayGateOptions = {}): ReplayGate {
  const maxEventIds = options.maxEventIds ?? DEFAULT_MAX_EVENT_IDS;
  const eventTtlMs = options.eventTtlMs ?? DEFAULT_EVENT_TTL_MS;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(maxEventIds) || maxEventIds < 1) {
    throw new Error('El límite de event_id debe ser un entero positivo.');
  }
  if (!Number.isFinite(eventTtlMs) || eventTtlMs <= 0) {
    throw new Error('El TTL de event_id debe ser positivo.');
  }

  const owner = Symbol('replay-gate');
  const streams = new Map<string, number>();
  const aggregates = new Map<string, number>();
  const rememberedEvents = new Map<string, RememberedEvent>();
  let epoch = 0;

  const ticket = (
    streamUpdates: readonly CursorUpdate[],
    aggregateUpdates: readonly CursorUpdate[],
    event: ReplayTicket['event'] = null,
  ): ReplayTicket => ({
    id: Symbol('replay-ticket'),
    owner,
    streamUpdates,
    aggregateUpdates,
    event,
    epoch,
    committed: false,
    aborted: false,
  });

  const pruneRememberedEvents = (at: number) => {
    for (const [eventId, remembered] of rememberedEvents) {
      if (at - remembered.seenAt <= eventTtlMs) break;
      rememberedEvents.delete(eventId);
    }
    while (rememberedEvents.size >= maxEventIds) {
      const oldest = rememberedEvents.keys().next().value as string | undefined;
      if (oldest == null) break;
      rememberedEvents.delete(oldest);
    }
  };

  const decideEvent = (
    metadata: RealtimeEventMetadata | null,
  ): ReplayDecision => {
    // El modo legacy conserva el comportamiento actual y no promete cursores.
    if (metadata == null) {
      return { kind: 'apply', ticket: ticket([], []) };
    }

    const fingerprint = eventFingerprint(metadata);
    const remembered = rememberedEvents.get(metadata.eventId);
    if (remembered != null && remembered.fingerprint !== fingerprint) {
      return { kind: 'resync', reason: 'event_id_conflict' };
    }

    const currentStream = streams.get(metadata.stream);
    if (currentStream == null) {
      return { kind: 'resync', reason: 'event_before_snapshot' };
    }
    if (metadata.streamVersion > currentStream + 1) {
      return { kind: 'resync', reason: 'stream_gap' };
    }

    if (metadata.streamVersion <= currentStream) {
      return {
        kind: 'drop',
        reason: remembered != null ? 'duplicate' : 'stale_stream',
        ticket: null,
      };
    }

    const streamUpdate: CursorUpdate = {
      key: metadata.stream,
      expected: currentStream,
      next: metadata.streamVersion,
    };
    const key = aggregateKey(metadata);
    const currentAggregate = aggregates.get(key);
    const aggregateUpdate: CursorUpdate = {
      key,
      expected: currentAggregate,
      next: Math.max(currentAggregate ?? 0, metadata.aggregateVersion),
    };
    const event = {
      id: metadata.eventId,
      fingerprint,
      seenAt: now(),
    };
    const nextTicket = ticket([streamUpdate], [aggregateUpdate], event);

    return { kind: 'apply', ticket: nextTicket };
  };

  const decideSnapshot = (
    checkpoints: readonly StreamCheckpoint[],
    requiredStreams: readonly string[],
  ): ReplayDecision => {
    const byStream = new Map<string, number>();
    for (const checkpoint of checkpoints) {
      if (
        byStream.has(checkpoint.stream) ||
        !Number.isInteger(checkpoint.version) ||
        checkpoint.version < 0
      ) {
        return { kind: 'resync', reason: 'invalid_snapshot' };
      }
      byStream.set(checkpoint.stream, checkpoint.version);
    }
    if (new Set(requiredStreams).size !== requiredStreams.length) {
      return { kind: 'resync', reason: 'invalid_snapshot' };
    }
    if (
      byStream.size !== requiredStreams.length ||
      requiredStreams.some((stream) => !byStream.has(stream))
    ) {
      return { kind: 'resync', reason: 'invalid_snapshot' };
    }

    const streamUpdates: CursorUpdate[] = [];
    for (const [stream, version] of byStream) {
      const current = streams.get(stream);
      if (current != null && version < current) {
        return { kind: 'resync', reason: 'stale_snapshot' };
      }
      streamUpdates.push({ key: stream, expected: current, next: version });
    }
    return { kind: 'apply', ticket: ticket(streamUpdates, []) };
  };

  const commit = (value: ReplayTicket) => {
    if (
      value.owner !== owner ||
      value.epoch !== epoch ||
      value.committed ||
      value.aborted
    ) {
      throw new Error('El ticket realtime no pertenece a este gate o ya fue consumido.');
    }
    for (const update of value.streamUpdates) {
      if (streams.get(update.key) !== update.expected) {
        throw new Error('El cursor del stream cambió antes de confirmar el ticket.');
      }
    }
    for (const update of value.aggregateUpdates) {
      if (aggregates.get(update.key) !== update.expected) {
        throw new Error('La versión del agregado cambió antes de confirmar el ticket.');
      }
    }

    for (const update of value.streamUpdates) {
      streams.set(update.key, update.next);
    }
    for (const update of value.aggregateUpdates) {
      aggregates.set(update.key, update.next);
    }
    if (value.event != null) {
      pruneRememberedEvents(value.event.seenAt);
      rememberedEvents.delete(value.event.id);
      rememberedEvents.set(value.event.id, {
        fingerprint: value.event.fingerprint,
        seenAt: value.event.seenAt,
      });
    }
    value.committed = true;
  };

  const abort = (value: ReplayTicket) => {
    if (
      value.owner !== owner ||
      value.epoch !== epoch ||
      value.committed ||
      value.aborted
    ) {
      throw new Error('El ticket realtime no pertenece a este gate o ya fue consumido.');
    }
    value.aborted = true;
  };

  const reset = () => {
    epoch += 1;
    streams.clear();
    aggregates.clear();
    rememberedEvents.clear();
  };

  const state = (): ReplayGateState => ({
    streams: new Map(streams),
    aggregates: new Map(aggregates),
    rememberedEventIds: rememberedEvents.size,
  });

  return { decideEvent, decideSnapshot, commit, abort, reset, state };
}
