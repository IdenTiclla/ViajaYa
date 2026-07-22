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

type RealtimeReplayConsumerOptions<TMessage> = {
  gate: ReplayGate;
  classify: (message: TMessage) => RealtimeProtocolClassification;
  applyLegacy: (message: TMessage) => Promise<PostCommitEffect>;
  applySnapshot: (message: TMessage) => Promise<PostCommitEffect>;
  applyEvent: (message: TMessage) => Promise<PostCommitEffect>;
  onResync: (reason: RealtimeResyncCause) => void;
};

export type RealtimeReplayConsumer<TMessage> = {
  beginConnection: () => void;
  consume: (message: TMessage) => Promise<RealtimeConsumeResult>;
  protocol: () => 'awaiting_snapshot' | 'legacy' | 'v2';
};

export function createRealtimeReplayConsumer<TMessage>(
  options: RealtimeReplayConsumerOptions<TMessage>,
): RealtimeReplayConsumer<TMessage> {
  let protocol: 'awaiting_snapshot' | 'legacy' | 'v2' = 'awaiting_snapshot';
  let legacyReady = false;
  let resyncRequested = false;

  const requestResync = (reason: RealtimeResyncCause): RealtimeConsumeResult => {
    if (!resyncRequested) {
      resyncRequested = true;
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

  const consume = async (message: TMessage): Promise<RealtimeConsumeResult> => {
    const classification = options.classify(message);

    if (classification.protocol === 'legacy') {
      if (protocol === 'v2') {
        return requestResync('protocol_mismatch');
      }
      if (protocol === 'awaiting_snapshot') {
        if (classification.kind !== 'snapshot') {
          return requestResync('event_before_snapshot');
        }
        protocol = 'legacy';
      }
      if (classification.kind === 'event' && !legacyReady) {
        return requestResync('event_before_snapshot');
      }
      try {
        const effect = await options.applyLegacy(message);
        if (
          classification.kind === 'snapshot' &&
          classification.completesHandshake
        ) {
          legacyReady = true;
        }
        runPostCommit(effect);
        return { kind: 'applied' };
      } catch {
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
        const effect = await options.applySnapshot(message);
        options.gate.commit(decision.ticket);
        protocol = 'v2';
        runPostCommit(effect);
        return { kind: 'applied' };
      } catch {
        abortSafely(decision.ticket);
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
      const effect = await options.applyEvent(message);
      options.gate.commit(decision.ticket);
      runPostCommit(effect);
      return { kind: 'applied' };
    } catch {
      abortSafely(decision.ticket);
      return requestResync('handler_error');
    }
  };

  return {
    beginConnection() {
      protocol = 'awaiting_snapshot';
      legacyReady = false;
      resyncRequested = false;
    },
    consume,
    protocol: () => protocol,
  };
}
