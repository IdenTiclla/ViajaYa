/**
 * Cliente WebSocket genérico con reconexión (compartido por los puentes de
 * negociación y, a futuro, la ubicación en vivo).
 *
 * - El access token viaja como query param `?token=…` (RN no permite cabeceras
 *   en `WebSocket`); se toma de `tokenStorage`.
 * - Reconexión con backoff exponencial (máx. 30 s) salvo cierre intencional.
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

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/**
 * Abre un socket al `path` indicado (p. ej. `/ws/rides/123`) y entrega cada
 * mensaje al callback. Devuelve un handle para cerrarlo.
 */
export function openSocket(
  path: string,
  onMessage: (msg: SocketMessage) => void,
): SocketHandle {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;

  const clearTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closedByUser || reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (closedByUser) return;
    const tokens = await tokenStorage.get();
    if (!tokens?.accessToken) {
      // Sin sesión todavía: reintenta más tarde.
      scheduleReconnect();
      return;
    }
    const sep = path.includes('?') ? '&' : '?';
    const url = `${env.wsUrl}${path}${sep}token=${encodeURIComponent(tokens.accessToken)}`;

    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as SocketMessage;
        if (parsed && typeof parsed.type === 'string') onMessage(parsed);
      } catch {
        // Mensaje no-JSON: lo ignoramos.
      }
    };
    socket.onerror = () => {
      // El cierre subsecuente dispara la reconexión.
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      scheduleReconnect();
    };
  };

  const onAppStateChange = (state: AppStateStatus) => {
    if (state === 'active' && !closedByUser && ws == null) {
      clearTimer();
      attempt = 0;
      void connect();
    }
  };
  const appStateSub = AppState.addEventListener('change', onAppStateChange);

  void connect();

  return {
    close() {
      closedByUser = true;
      clearTimer();
      appStateSub.remove();
      ws?.close();
      ws = null;
    },
  };
}
