/**
 * Generic WebSocket client with reconnection (shared by the negotiation
 * bridges and, in the future, live location).
 *
 * - The access token travels as a WebSocket subprotocol (out of the URL and the
 *   access logs); it is read from `tokenStorage`.
 * - Reconnection with exponential backoff (max 5 s) unless closed on purpose.
 * - Reconnects when the app returns to the foreground (`AppState`).
 *
 * It is downstream only: it parses each `{ type, data }` message and hands it to the
 * callback. It sends no messages (actions still go over HTTP).
 */
import { AppState, type AppStateStatus } from 'react-native';

import { env } from '@/core/config/env';
import { tokenStorage } from '@/core/http/tokenStorage';
import { createGenerationMessageQueue } from '@/core/realtime/socketQueue';

export type SocketMessage = { type: string; data: unknown };
export type SocketHandle = {
  close: () => void;
  /** Discard the current generation and force a new handshake. */
  resync: () => void;
};

/** Live identity of the physical connection that delivered a message. */
export type SocketDeliveryContext = {
  isCurrent: () => boolean;
};

export type SocketLifecycleCallbacks = {
  onConnection?: () => void;
  onClose?: (close: SanitizedSocketClose) => void;
  onInvalidFrame?: (issue: SanitizedSocketIssue) => void;
  onHandlerError?: () => void;
};

type ParserIssue = {
  code?: string;
  path?: PropertyKey[];
};

export type SocketMessageParser<T extends SocketMessage> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | { success: false; error: { issues?: ParserIssue[] } };
};

export type SanitizedSocketIssue = {
  type: string;
  path: string;
  message: string;
};

export type SanitizedSocketClose = {
  code: number;
  wasClean: boolean;
};

export type SocketFrameResult<T extends SocketMessage> =
  | { success: true; data: T }
  | { success: false; issue: SanitizedSocketIssue };

// It must stay well below the backend's presence grace period.
// In the worst visible case we retry every 5 s, not right when the grace period runs out.
const MAX_BACKOFF_MS = 5_000;
const BASE_BACKOFF_MS = 1_000;
const AUTH_SUBPROTOCOL = 'viajaya.auth';

function safeMessageType(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    /^[a-z0-9_]{1,64}$/.test(value.type)
  ) {
    return value.type;
  }
  return 'unknown';
}

function safeIssuePath(path: PropertyKey[] | undefined): string {
  if (!path?.length) return '$';
  return path
    .slice(0, 8)
    .map((part) =>
      typeof part === 'number' || /^[a-zA-Z0-9_]{1,64}$/.test(String(part))
        ? String(part)
        : '?',
    )
    .join('.');
}

function safeIssueMessage(code: string | undefined): string {
  switch (code) {
    case 'invalid_type':
      return 'El tipo de dato no coincide con el contrato.';
    case 'invalid_value':
    case 'invalid_literal':
    case 'invalid_enum_value':
      return 'El valor no pertenece al contrato.';
    case 'too_small':
    case 'too_big':
      return 'El valor está fuera del rango permitido.';
    case 'custom':
      return 'El valor no cumple las reglas del contrato.';
    default:
      return 'El mensaje no cumple el contrato WebSocket.';
  }
}

/** Validate a text frame without including its content in the returned error. */
export function parseSocketFrame<T extends SocketMessage>(
  frame: unknown,
  parser: SocketMessageParser<T>,
): SocketFrameResult<T> {
  if (typeof frame !== 'string') {
    return {
      success: false,
      issue: {
        type: 'unknown',
        path: '$',
        message: 'El frame WebSocket no es texto JSON.',
      },
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(frame) as unknown;
  } catch {
    return {
      success: false,
      issue: {
        type: 'unknown',
        path: '$',
        message: 'El frame WebSocket no contiene JSON válido.',
      },
    };
  }

  const result = parser.safeParse(value);
  if (result.success) return result;

  const firstIssue = result.error.issues?.[0];
  return {
    success: false,
    issue: {
      type: safeMessageType(value),
      path: safeIssuePath(firstIssue?.path),
      message: safeIssueMessage(firstIssue?.code),
    },
  };
}

/**
 * Open a socket to the given `path` (e.g. `/ws/rides/123`) and hand each
 * message to the callback. Returns a handle to close it.
 */
export function openSocket<T extends SocketMessage>(
  path: string,
  onMessage: (
    msg: T,
    context: SocketDeliveryContext,
  ) => void | Promise<void>,
  parser: SocketMessageParser<T>,
  callbacks: SocketLifecycleCallbacks = {},
): SocketHandle {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;
  const messageQueue = createGenerationMessageQueue();
  // Every intentional replacement invalidates the previous generation's callbacks and
  // in-flight opens. This avoids two live sockets if SecureStore is slow and the
  // app comes back to the foreground while the first connect is still pending.
  let generation = messageQueue.currentGeneration();
  let connectingGeneration: number | null = null;

  const clearTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (expectedGeneration = generation) => {
    if (closedByUser || reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closedByUser || expectedGeneration !== generation) return;
      void connect();
    }, delay);
  };

  const connect = async () => {
    const ownGeneration = generation;
    if (
      closedByUser ||
      ws != null ||
      connectingGeneration === ownGeneration
    ) {
      return;
    }

    connectingGeneration = ownGeneration;
    try {
      const tokens = await tokenStorage.get();
      if (closedByUser || ownGeneration !== generation) return;
      if (!tokens?.accessToken) {
        // No session yet: retry later.
        scheduleReconnect(ownGeneration);
        return;
      }
      const url = `${env.wsUrl}${path}`;
      const socket = new WebSocket(url, [AUTH_SUBPROTOCOL, tokens.accessToken]);

      if (closedByUser || ownGeneration !== generation) {
        socket.close();
        return;
      }
      ws = socket;
      const deliveryContext: SocketDeliveryContext = {
        isCurrent: () =>
          !closedByUser && ws === socket && ownGeneration === generation,
      };

      socket.onopen = () => {
        if (ws !== socket || ownGeneration !== generation) return;
        attempt = 0;
        callbacks.onConnection?.();
      };
      socket.onmessage = (event) => {
        if (ws !== socket || ownGeneration !== generation) return;
        const parsed = parseSocketFrame(event.data, parser);
        if (!parsed.success) {
          // Only logs metadata derived from the schema. Never the frame, the
          // payload or the URL (which may identify a specific ride).
          console.warn('Mensaje WebSocket descartado.', parsed.issue);
          callbacks.onInvalidFrame?.(parsed.issue);
          return;
        }

        // Snapshot and deltas form an ordered stream. Serializing the handlers
        // keeps a snapshot with an `await` from finishing after a later
        // event and overwriting a freshly received offer.
        messageQueue.enqueue(
          ownGeneration,
          () => {
            if (!deliveryContext.isCurrent()) return;
            return onMessage(parsed.data, deliveryContext);
          },
          () => callbacks.onHandlerError?.(),
        );
      };
      socket.onerror = () => {
        // El cierre subsecuente dispara la reconexion.
      };
      socket.onclose = (event) => {
        callbacks.onClose?.({
          code:
            Number.isInteger(event.code) && event.code >= 0 && event.code <= 4_999
              ? event.code
              : 0,
          wasClean: event.wasClean === true,
        });
        if (ws === socket) ws = null;
        if (!closedByUser && ownGeneration === generation) {
          // Each physical transport delimits a generation: a handler that
          // was still waiting on IO cannot complete inside the reconnection.
          generation = messageQueue.advanceGeneration();
          scheduleReconnect(generation);
        }
      };
    } catch {
      if (!closedByUser && ownGeneration === generation) {
        scheduleReconnect(ownGeneration);
      }
    } finally {
      if (connectingGeneration === ownGeneration) {
        connectingGeneration = null;
      }
    }
  };

  const onAppStateChange = (state: AppStateStatus) => {
    if (state !== 'active' || closedByUser) return;

    // Android may keep an OPEN/CONNECTING object even though the transport
    // died while JS was suspended. On return, we always replace
    // the connection: the backend cancels the grace period as soon as the new socket comes in.
    generation = messageQueue.advanceGeneration();
    clearTimer();
    attempt = 0;
    const staleSocket = ws;
    ws = null;
    staleSocket?.close();
    void connect();
  };
  const appStateSub = AppState.addEventListener('change', onAppStateChange);

  void connect();

  return {
    resync() {
      if (closedByUser) return;
      generation = messageQueue.advanceGeneration();
      clearTimer();
      const socket = ws;
      ws = null;
      connectingGeneration = null;
      socket?.close();
      scheduleReconnect(generation);
    },
    close() {
      closedByUser = true;
      generation = messageQueue.advanceGeneration();
      clearTimer();
      appStateSub.remove();
      const socket = ws;
      ws = null;
      socket?.close();
    },
  };
}
