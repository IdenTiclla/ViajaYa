/** One Android foreground service keeps sharing while another navigator is open. */
import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { getApiErrorStatus } from '@/core/errors/apiError';
import { driverLocationRepository, type DriverLocationInput } from '../data/driverLocationRepository';
import { useLocationSharingStore } from './locationSharingStore';

const TASK_NAME = 'viajaya-driver-trip-location';
const CONTEXT_KEY = 'viajaya.driver-tracking.v1';
type TrackingContext = { rideId: string; userId: string };
let current: TrackingContext | null = null;
let foreground: Location.LocationSubscription | null = null;
let inFlight: AbortController | null = null;
let operation = Promise.resolve();
let lastSent = 0;
let generation = 0;
let signalTimer: ReturnType<typeof setTimeout> | null = null;
function watchSignal(context: TrackingContext) {
  if (signalTimer) clearTimeout(signalTimer);
  signalTimer = setTimeout(() => {
    if (current === context) useLocationSharingStore.setState({ status: 'error', error: 'No recibimos una señal GPS reciente. Comprueba que la ubicación siga activada.' });
  }, 25_000);
}
const taskManager = requireOptionalNativeModule('ExpoTaskManager')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Avoid loading absent modules in older APKs.
  ? require('expo-task-manager') as typeof import('expo-task-manager') : null;

export const canShareWhileAway = Platform.OS === 'android' && taskManager !== null;

function inputFromLocation(location: Location.LocationObject): DriverLocationInput | null {
  const { latitude, longitude, accuracy, heading } = location.coords;
  if (accuracy == null || accuracy > 100 || accuracy < 0 || !Number.isFinite(accuracy)
    || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180
    || !Number.isFinite(location.timestamp)
    || Date.now() - location.timestamp > 60_000 || location.timestamp > Date.now() + 5_000) return null;
  return { latitude, longitude, accuracy_meters: accuracy,
    heading: heading != null && heading >= 0 && heading < 360 ? heading : null,
    captured_at: new Date(location.timestamp).toISOString() };
}
async function deliver(location: Location.LocationObject) {
  const context = current;
  if (!context || inFlight || Date.now() - lastSent < 3_000) return;
  const input = inputFromLocation(location);
  if (!input) {
    useLocationSharingStore.setState({ status: 'error', error: 'Esperando una señal GPS más precisa.' });
    return;
  }
  useLocationSharingStore.setState({ coordinates: location.coords, heading: input.heading });
  const controller = new AbortController(); inFlight = controller; lastSent = Date.now();
  try {
    await driverLocationRepository.report(context.rideId, input, controller.signal);
    if (current === context) {
      useLocationSharingStore.setState({ status: 'sharing', error: null });
      watchSignal(context);
    }
  } catch (error) {
    if (current !== context || controller.signal.aborted) return;
    if ([401, 403, 409].includes(getApiErrorStatus(error) ?? 0)) { void stopSharing(); return; }
    useLocationSharingStore.setState({ status: 'error', error: 'No pudimos compartir tu ubicación. Reintentaremos con la siguiente señal.' });
  } finally { if (inFlight === controller) inFlight = null; }
}
if (taskManager) {
  // Fast Refresh must replace the callback along with this module's context.
  taskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK_NAME, async ({ data, error }) => {
    if (error) { useLocationSharingStore.setState({ status: 'error', error: 'La señal de ubicación se interrumpió.' }); return; }
    // A foreground service may restart the JS runtime; recover only its trip ID,
    // never a location history. The authenticated API rechecks the assigned user.
    if (!current) {
      if (generation !== 0) return;
      const beforeRead = generation;
      const stored = await SecureStore.getItemAsync(CONTEXT_KEY);
      if (!stored || beforeRead !== generation) return;
      try {
        const saved: unknown = JSON.parse(stored);
        if (!saved || typeof saved !== 'object' || !('rideId' in saved) || !('userId' in saved)
          || typeof saved.rideId !== 'string' || typeof saved.userId !== 'string') return;
        current = { rideId: saved.rideId, userId: saved.userId };
        useLocationSharingStore.setState({ rideId: current.rideId, status: 'starting' });
      } catch { return; }
    }
    const latest = data?.locations?.at(-1);
    if (latest) await deliver(latest);
  });
}
async function stop() {
  if (signalTimer) clearTimeout(signalTimer); signalTimer = null;
  current = null; inFlight?.abort(); inFlight = null; lastSent = 0;
  foreground?.remove(); foreground = null;
  await SecureStore.deleteItemAsync(CONTEXT_KEY);
  if (taskManager && await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) await Location.stopLocationUpdatesAsync(TASK_NAME);
  useLocationSharingStore.setState({ rideId: null, coordinates: null, heading: null, status: 'off', error: null });
}
export function stopSharing(): Promise<void> {
  // Invalidate a pending permission/start request immediately, before cleanup.
  generation += 1; current = null; inFlight?.abort();
  operation = operation.catch(() => {}).then(stop).catch(() => {
    useLocationSharingStore.setState({ status: 'error', error: 'No pudimos detener el servicio de ubicación. Vuelve a abrir ViajaYa.' });
  });
  return operation;
}
export function startSharing(context: TrackingContext): Promise<void> {
  if (current?.rideId === context.rideId && current.userId === context.userId
    && ['starting', 'sharing'].includes(useLocationSharingStore.getState().status)) return operation;
  const expectedGeneration = ++generation;
  current = null; inFlight?.abort();
  operation = operation.catch(() => {}).then(async () => {
    if (expectedGeneration !== generation || AppState.currentState !== 'active') return;
    await stop();
    if (expectedGeneration !== generation) return;
    current = context;
    useLocationSharingStore.setState({ rideId: context.rideId, status: 'starting', error: null });
    const existingPermission = await Location.getForegroundPermissionsAsync();
    if (current !== context) return;
    const permission = existingPermission.granted ? existingPermission : await Location.requestForegroundPermissionsAsync();
    if (current !== context) return;
    if (!permission.granted) throw new Error('Permite la ubicación para que tu pasajero pueda ver dónde estás.');
    await SecureStore.setItemAsync(CONTEXT_KEY, JSON.stringify(context));
    if (current !== context) return;
    if (Platform.OS === 'android' && taskManager) {
      await Location.startLocationUpdatesAsync(TASK_NAME, {
        accuracy: Location.Accuracy.High, timeInterval: 5_000, distanceInterval: 0,
        foregroundService: { notificationTitle: 'ViajaYa · viaje activo',
          notificationBody: 'Compartiendo tu ubicación con el pasajero de este viaje.',
          notificationColor: '#16308C', killServiceOnDestroy: true },
      });
    } else {
      foreground?.remove();
      foreground = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5_000, distanceInterval: 0 }, location => { void deliver(location); });
    }
    if (current !== context) return;
    watchSignal(context);
    // The offer may already have obtained a recent fix. Publish it immediately
    // while the continuous provider acquires its first sample.
    void Location.getLastKnownPositionAsync({ maxAge: 15_000, requiredAccuracy: 100 })
      .then(location => { if (current === context && location) return deliver(location); })
      .catch(() => {});
  }).catch(error => {
    if (__DEV__) console.warn('[driver-location] Could not start location sharing:', error instanceof Error ? error.message : 'Unknown location error');
    if (expectedGeneration === generation) useLocationSharingStore.setState({ rideId: context.rideId, status: 'error', error: error instanceof Error && error.message.startsWith('Permite la ubicación') ? error.message : 'No pudimos iniciar tu ubicación. Comprueba el GPS y vuelve a intentarlo.' });
  });
  return operation;
}
