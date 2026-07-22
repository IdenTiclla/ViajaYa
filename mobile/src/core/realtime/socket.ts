/**
 * Cliente WebSocket genérico con reconexión (compartido por los puentes de
 * negociación y, a futuro, la ubicación en vivo).
 *
 * - El access token viaja como subprotocolo WebSocket (fuera de la URL y de los
 *   access logs); se toma de `tokenStorage`.
 * - Reconexión con backoff exponencial (máx. 5 s) salvo cierre intencional.
 * - Reconecta al volver la app a primer plano (`AppState`).
 *
 * Es solo de bajada: parsea cada mensaje `{ type, data }` y lo entrega al
 * callback. No envía mensajes (las acciones siguen por HTTP).
 */
import { AppState, type AppStateStatus } from 'react-native';

import { env } from '@/core/config/env';
import { tokenStorage } from '@/core/http/tokenStorage';
import { createGenerationMessageQueue } from '@/core/realtime/socketQueue';

export type SocketMessage = { type: string; data: unknown };
export type SocketHandle = {
  close: () => void;
  /** Descarta la generación actual y fuerza un handshake nuevo. */
  resync: () => void;
};

/** Identidad viva de la conexión física que entregó un mensaje. */
export type SocketDeliveryContext = {
  isCurrent: () => boolean;
};

export type SocketLifecycleCallbacks = {
  onConnection?: () => void;
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

export type SocketFrameResult<T extends SocketMessage> =
  | { success: true; data: T }
  | { success: false; issue: SanitizedSocketIssue };

// Debe quedar holgadamente por debajo de la gracia de presencia del backend.
// En el peor caso visible reintentamos cada 5 s, no justo cuando vence la gracia.
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

/** Valida un frame de texto sin incluir su contenido en el error retornado. */
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
 * Abre un socket al `path` indicado (p. ej. `/ws/rides/123`) y entrega cada
 * mensaje al callback. Devuelve un handle para cerrarlo.
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
  // Cada reemplazo intencional invalida callbacks y aperturas en curso de la
  // generacion anterior. Esto evita dos sockets vivos si SecureStore tarda y la
  // app vuelve a foreground mientras el primer connect aun esta pendiente.
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
        // Sin sesión todavía: reintenta más tarde.
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
          // Solo registra metadatos derivados del schema. Nunca el frame, el
          // payload ni la URL (que puede identificar un ride concreto).
          console.warn('Mensaje WebSocket descartado.', parsed.issue);
          callbacks.onInvalidFrame?.(parsed.issue);
          return;
        }

        // Snapshot y deltas forman un stream ordenado. Serializar los handlers
        // evita que un snapshot con un `await` termine despues de un evento
        // posterior y pise una oferta recien recibida.
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
      socket.onclose = () => {
        if (ws === socket) ws = null;
        if (!closedByUser && ownGeneration === generation) {
          // Cada transporte físico delimita una generación: un handler que
          // seguía esperando IO no puede completar dentro de la reconexión.
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

    // Android puede conservar un objeto OPEN/CONNECTING aunque el transporte
    // haya muerto mientras JS estuvo suspendido. Al volver, reemplazamos siempre
    // la conexion: el backend cancela la gracia en cuanto entra el nuevo socket.
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
