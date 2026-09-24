import * as Location from 'expo-location';

import type { Coordinates } from '@/core/domain/geo';
import { rumboDeBrujula, rumboDelMovimiento, type MuestraMovimiento } from '../domain/orientacionUbicacion';

export type DisponibilidadUbicacion = 'granted' | 'denied' | 'disabled';

/** Silent query: coming back to the app must not open another permission dialog. */
export async function consultarDisponibilidadUbicacion(): Promise<DisponibilidadUbicacion> {
  const permiso = await Location.getForegroundPermissionsAsync();
  if (permiso.status !== Location.PermissionStatus.GRANTED) return 'denied';
  return await Location.hasServicesEnabledAsync() ? 'granted' : 'disabled';
}

// The one-off request cannot be cancelled in Expo. Sharing it avoids piling up
// native requests when retrying while the provider is still answering.
let posicionInicialPendiente: Promise<Location.LocationObject> | null = null;
function obtenerPosicionInicial() {
  if (!posicionInicialPendiente) {
    const solicitud = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false,
    });
    posicionInicialPendiente = solicitud;
    void solicitud.then(
      () => { if (posicionInicialPendiente === solicitud) posicionInicialPendiente = null; },
      () => { if (posicionInicialPendiente === solicitud) posicionInicialPendiente = null; },
    );
  }
  return posicionInicialPendiente;
}

/** GPS and compass share a cancellation, even if the native subscription arrives late. */
export async function observarUbicacion(
  actualizar: (coordinates: Coordinates, rumbo: number | null) => void,
  error?: (motivo: 'error' | 'disabled') => void,
  signal?: AbortSignal,
): Promise<{ remove: () => void } | null> {
  if (signal?.aborted) return null;
  let permiso = await Location.getForegroundPermissionsAsync();
  if (signal?.aborted) return null;
  if (permiso.status !== Location.PermissionStatus.GRANTED && permiso.canAskAgain) {
    permiso = await Location.requestForegroundPermissionsAsync();
  }
  if (signal?.aborted) return null;
  if (permiso.status !== Location.PermissionStatus.GRANTED) return null;
  const serviciosActivos = await Location.hasServicesEnabledAsync();
  if (signal?.aborted) return null;
  if (!serviciosActivos) { error?.('disabled'); return null; }

  let activo = true;
  let posicion: Location.LocationSubscription | null = null;
  let brujula: Location.LocationSubscription | null = null;
  let ultima: MuestraMovimiento | null = null;
  let movimiento: number | null = null;
  let orientacion: number | null = null;
  let instanteBrujula = 0;
  let ultimoRumbo: number | null = null;
  let ultimaEmision = 0;

  const remove = () => {
    if (!activo) return;
    activo = false;
    signal?.removeEventListener('abort', remove);
    posicion?.remove();
    brujula?.remove();
  };
  const fallar = () => {
    if (!activo) return;
    remove();
    error?.('error');
  };
  const emitir = (nuevaPosicion: boolean) => {
    if (!activo || !ultima) return;
    const ahora = Date.now();
    if (ahora - ultima.timestamp > 30_000) return;
    const rumbo = movimiento != null && ahora - ultima.timestamp <= 5000
      ? movimiento
      : orientacion != null && ahora - instanteBrujula <= 3000 ? orientacion : ultimoRumbo;
    const cambio = rumbo != null && ultimoRumbo != null
      ? Math.abs(((rumbo - ultimoRumbo + 540) % 360) - 180) : Infinity;
    // The compass must not redraw the whole request list at the sensor's frequency.
    if (!nuevaPosicion && ultimoRumbo != null && (ahora - ultimaEmision < 150 || cambio < 2)) return;
    ultimoRumbo = rumbo;
    ultimaEmision = ahora;
    actualizar(ultima.coordinates, rumbo);
  };

  const recibirPosicion = (lectura: Location.LocationObject) => {
    if (!activo || (ultima && lectura.timestamp <= ultima.timestamp)) return;
    const { latitude, longitude, heading, speed, accuracy } = lectura.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(lectura.timestamp)
      || Date.now() - lectura.timestamp > 30_000 || lectura.timestamp > Date.now() + 5000) return;
    const nueva: MuestraMovimiento = {
      coordinates: { latitude, longitude }, rumbo: heading,
      velocidad: speed, precision: accuracy, timestamp: lectura.timestamp,
    };
    movimiento = rumboDelMovimiento(ultima, nueva);
    ultima = nueva;
    emitir(true);
  };
  signal?.addEventListener('abort', remove, { once: true });

  // A single continuous listener. The SDK pauses/resumes the provider when the
  // Activity changes; disabling its automatic dialog avoids pause/subscribe loops.
  void Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0,
      mayShowUserSettingsDialog: false },
    recibirPosicion,
    fallar,
  ).then((suscripcion) => {
    if (activo) posicion = suscripcion;
    else suscripcion.remove();
  }).catch(fallar);

  // One-off start with the fused provider (network/GPS): it does not wait for
  // the high-accuracy acquisition to finish, nor repeat on every render.
  void obtenerPosicionInicial().then((lectura) => {
    if (!ultima) recibirPosicion(lectura);
  }).catch(() => undefined);

  // A device without a compass keeps GPS tracking.
  void Location.watchHeadingAsync((lectura) => {
    if (!activo) return;
    orientacion = rumboDeBrujula(lectura);
    instanteBrujula = Date.now();
    emitir(false);
  }, () => { orientacion = null; }).then((suscripcion) => {
    if (activo) brujula = suscripcion;
    else suscripcion.remove();
  }).catch(() => { orientacion = null; });

  return { remove };
}
