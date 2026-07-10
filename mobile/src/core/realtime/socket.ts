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

export type SocketMessage = { type: string; data: unknown };
export type SocketHandle = { close: () => void };

// Debe quedar holgadamente por debajo de la gracia de presencia del backend.
// En el peor caso visible reintentamos cada 5 s, no justo cuando vence la gracia.
const MAX_BACKOFF_MS = 5_000;
const BASE_BACKOFF_MS = 1_000;
const AUTH_SUBPROTOCOL = 'viajaya.auth';

/**
 * Abre un socket al `path` indicado (p. ej. `/ws/rides/123`) y entrega cada
 * mensaje al callback. Devuelve un handle para cerrarlo.
 */
export function openSocket(
  path: string,
  onMessage: (msg: SocketMessage) => void | Promise<void>,
): SocketHandle {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;
  let messageQueue: Promise<void> = Promise.resolve();
  // Cada reemplazo intencional invalida callbacks y aperturas en curso de la
  // generacion anterior. Esto evita dos sockets vivos si SecureStore tarda y la
  // app vuelve a foreground mientras el primer connect aun esta pendiente.
  let generation = 0;
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

      socket.onopen = () => {
        if (ws !== socket || ownGeneration !== generation) return;
        attempt = 0;
      };
      socket.onmessage = (event) => {
        if (ws !== socket || ownGeneration !== generation) return;
        try {
          const parsed = JSON.parse(event.data as string) as SocketMessage;
          if (parsed && typeof parsed.type === 'string') {
            // Snapshot y deltas forman un stream ordenado. Serializar los handlers
            // evita que un snapshot con un `await` termine despues de un evento
            // posterior y pise una oferta recien recibida.
            messageQueue = messageQueue
              .then(() => {
                if (ws !== socket || ownGeneration !== generation) return;
                return onMessage(parsed);
              })
              .catch(() => undefined);
          }
        } catch {
          // Mensaje no-JSON: lo ignoramos.
        }
      };
      socket.onerror = () => {
        // El cierre subsecuente dispara la reconexion.
      };
      socket.onclose = () => {
        if (ws === socket) ws = null;
        if (ownGeneration === generation) {
          scheduleReconnect(ownGeneration);
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
    generation += 1;
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
    close() {
      closedByUser = true;
      generation += 1;
      clearTimer();
      appStateSub.remove();
      const socket = ws;
      ws = null;
      socket?.close();
    },
  };
}
