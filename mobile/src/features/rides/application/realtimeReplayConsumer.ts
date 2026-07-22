/** Coordinador puro de protocolo legacy/v2 y replay por conexión WebSocket. */

import type {
  RealtimeEventMetadata,
  ReplayGate,
  ReplayResyncReason,
  StreamCheckpoint,
} from '../../../core/realtime/replayGate';

export type RealtimeProtocolClassification =
  | {
      protocol: 'legacy';
      kind: 'snapshot';
      completesHandshake: boolean;
    }
  | { protocol: 'legacy'; kind: 'event' }
  | {
      protocol: 'v2';
      kind: 'snapshot';
      checkpoints: readonly StreamCheckpoint[];
      requiredStreams: readonly string[];
    }
  | {
      protocol: 'v2';
      kind: 'event';
      metadata: RealtimeEventMetadata;
    };

export type RealtimeResyncCause =
  | ReplayResyncReason
  | 'protocol_mismatch'
  | 'handler_error';

export type RealtimeConsumeResult =
  | { kind: 'applied' }
  | { kind: 'dropped' }
  | { kind: 'resync'; reason: RealtimeResyncCause };

type PostCommitEffect = (() => void) | void;

/** Barrera externa que permite al transporte invalidar un handler en curso. */
export type RealtimeConnectionGuard = {
  isCurrent: () => boolean;
};

type RealtimeReplayConsumerOptions<TMessage> = {
  gate: ReplayGate;
  classify: (message: TMessage) => RealtimeProtocolClassification;
  applyLegacy: (
    message: TMessage,
    guard: RealtimeConnectionGuard,
  ) => Promise<PostCommitEffect>;
  applySnapshot: (
    message: TMessage,
    guard: RealtimeConnectionGuard,
  ) => Promise<PostCommitEffect>;
  applyEvent: (
    message: TMessage,
    guard: RealtimeConnectionGuard,
  ) => Promise<PostCommitEffect>;
  onResync: (reason: RealtimeResyncCause) => void;
};

export type RealtimeReplayConsumer<TMessage> = {
  /** Inicia una conexión e invalida cualquier handler de la anterior. */
  beginConnection: () => RealtimeConnectionGuard;
  /**
   * Invalida inmediatamente la conexión actual sin borrar cursores confirmados.
   * El transporte debe llamarlo al cerrar, reemplazar o resincronizar el socket.
   */
  invalidateConnection: () => void;
  consume: (
    message: TMessage,
    guard?: RealtimeConnectionGuard,
  ) => Promise<RealtimeConsumeResult>;
  protocol: () => 'awaiting_snapshot' | 'legacy' | 'v2';
};

export function createRealtimeReplayConsumer<TMessage>(
  options: RealtimeReplayConsumerOptions<TMessage>,
): RealtimeReplayConsumer<TMessage> {
  let protocol: 'awaiting_snapshot' | 'legacy' | 'v2' = 'awaiting_snapshot';
  let legacyReady = false;
  let resyncRequested = false;
  let connectionEpoch = 0;
  let connectionActive = false;

  const invalidateState = () => {
    connectionEpoch += 1;
    connectionActive = false;
    protocol = 'awaiting_snapshot';
    legacyReady = false;
  };

  const requestResync = (reason: RealtimeResyncCause): RealtimeConsumeResult => {
    if (!resyncRequested) {
      resyncRequested = true;
      invalidateState();
      options.onResync(reason);
    }
    return { kind: 'resync', reason };
  };

  const runPostCommit = (effect: PostCommitEffect) => {
    try {
      effect?.();
    } catch {
      // La proyección material ya fue confirmada; un efecto visual no fuerza replay.
    }
  };

  const abortSafely = (ticket: Parameters<ReplayGate['abort']>[0]) => {
    try {
      options.gate.abort(ticket);
    } catch {
      // Un ticket consumido o invalidado ya no puede mover cursores.
    }
  };

  const consume = async (
    message: TMessage,
    guard?: RealtimeConnectionGuard,
  ): Promise<RealtimeConsumeResult> => {
    const expectedEpoch = connectionEpoch;
    const isCurrent = () =>
      connectionActive &&
      expectedEpoch === connectionEpoch &&
      (guard?.isCurrent() ?? true);
    if (!isCurrent()) return { kind: 'dropped' };
    const applyGuard: RealtimeConnectionGuard = { isCurrent };

    const classification = options.classify(message);

    if (classification.protocol === 'legacy') {
      if (protocol === 'v2') {
        return requestResync('protocol_mismatch');
      }
      if (protocol === 'awaiting_snapshot') {
        if (classification.kind !== 'snapshot') {
          return requestResync('event_before_snapshot');
        }
      }
      if (classification.kind === 'event' && !legacyReady) {
        return requestResync('event_before_snapshot');
      }
      try {
        const effect = await options.applyLegacy(message, applyGuard);
        if (!isCurrent()) return { kind: 'dropped' };
        if (protocol === 'awaiting_snapshot') protocol = 'legacy';
        if (
          classification.kind === 'snapshot' &&
          classification.completesHandshake
        ) {
          legacyReady = true;
        }
        runPostCommit(effect);
        return { kind: 'applied' };
      } catch {
        if (!isCurrent()) return { kind: 'dropped' };
        return requestResync('handler_error');
      }
    }

    if (protocol === 'legacy') {
      return requestResync('protocol_mismatch');
    }

    if (classification.kind === 'snapshot') {
      const decision = options.gate.decideSnapshot(
        classification.checkpoints,
        classification.requiredStreams,
      );
      if (decision.kind !== 'apply') {
        return requestResync(
          decision.kind === 'resync' ? decision.reason : 'invalid_snapshot',
        );
      }
      try {
        const effect = await options.applySnapshot(message, applyGuard);
        if (!isCurrent()) {
          abortSafely(decision.ticket);
          return { kind: 'dropped' };
        }
        options.gate.commit(decision.ticket);
        protocol = 'v2';
        runPostCommit(effect);
        return { kind: 'applied' };
      } catch {
        abortSafely(decision.ticket);
        if (!isCurrent()) return { kind: 'dropped' };
        return requestResync('handler_error');
      }
    }

    if (protocol !== 'v2') {
      return requestResync('event_before_snapshot');
    }
    const decision = options.gate.decideEvent(classification.metadata);
    if (decision.kind === 'drop') return { kind: 'dropped' };
    if (decision.kind === 'resync') return requestResync(decision.reason);

    try {
      const effect = await options.applyEvent(message, applyGuard);
      if (!isCurrent()) {
        abortSafely(decision.ticket);
        return { kind: 'dropped' };
      }
      options.gate.commit(decision.ticket);
      runPostCommit(effect);
      return { kind: 'applied' };
    } catch {
      abortSafely(decision.ticket);
      if (!isCurrent()) return { kind: 'dropped' };
      return requestResync('handler_error');
    }
  };

  return {
    beginConnection() {
      connectionEpoch += 1;
      connectionActive = true;
      protocol = 'awaiting_snapshot';
      legacyReady = false;
      resyncRequested = false;
      const ownEpoch = connectionEpoch;
      return {
        isCurrent: () => connectionActive && ownEpoch === connectionEpoch,
      };
    },
    invalidateConnection() {
      if (!connectionActive) return;
      resyncRequested = true;
      invalidateState();
    },
    consume,
    protocol: () => protocol,
  };
}
