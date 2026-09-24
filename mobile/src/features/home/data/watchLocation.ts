import * as Location from 'expo-location';

import type { Coordinates } from '@/core/domain/geo';
import { compassHeading, movementHeading, type MovementSample } from '../domain/locationHeading';

export type LocationAvailability = 'granted' | 'denied' | 'disabled';

/** Silent query: coming back to the app must not open another permission dialog. */
export async function checkLocationAvailability(): Promise<LocationAvailability> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) return 'denied';
  return await Location.hasServicesEnabledAsync() ? 'granted' : 'disabled';
}

// The one-off request cannot be cancelled in Expo. Sharing it avoids piling up
// native requests when retrying while the provider is still answering.
let pendingInitialPosition: Promise<Location.LocationObject> | null = null;
function getInitialPosition() {
  if (!pendingInitialPosition) {
    const request = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false,
    });
    pendingInitialPosition = request;
    void request.then(
      () => { if (pendingInitialPosition === request) pendingInitialPosition = null; },
      () => { if (pendingInitialPosition === request) pendingInitialPosition = null; },
    );
  }
  return pendingInitialPosition;
}

/** GPS and compass share a cancellation, even if the native subscription arrives late. */
export async function watchLocation(
  update: (coordinates: Coordinates, heading: number | null) => void,
  error?: (reason: 'error' | 'disabled') => void,
  signal?: AbortSignal,
): Promise<{ remove: () => void } | null> {
  if (signal?.aborted) return null;
  let permission = await Location.getForegroundPermissionsAsync();
  if (signal?.aborted) return null;
  if (permission.status !== Location.PermissionStatus.GRANTED && permission.canAskAgain) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (signal?.aborted) return null;
  if (permission.status !== Location.PermissionStatus.GRANTED) return null;
  const activeServices = await Location.hasServicesEnabledAsync();
  if (signal?.aborted) return null;
  if (!activeServices) { error?.('disabled'); return null; }

  let active = true;
  let positionSubscription: Location.LocationSubscription | null = null;
  let compass: Location.LocationSubscription | null = null;
  let last: MovementSample | null = null;
  let movement: number | null = null;
  let orientation: number | null = null;
  let compassInstant = 0;
  let lastHeading: number | null = null;
  let lastEmission = 0;

  const remove = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', remove);
    positionSubscription?.remove();
    compass?.remove();
  };
  const fail = () => {
    if (!active) return;
    remove();
    error?.('error');
  };
  const emit = (newPosition: boolean) => {
    if (!active || !last) return;
    const now = Date.now();
    if (now - last.timestamp > 30_000) return;
    const heading = movement != null && now - last.timestamp <= 5000
      ? movement
      : orientation != null && now - compassInstant <= 3000 ? orientation : lastHeading;
    const change = heading != null && lastHeading != null
      ? Math.abs(((heading - lastHeading + 540) % 360) - 180) : Infinity;
    // The compass must not redraw the whole request list at the sensor's frequency.
    if (!newPosition && lastHeading != null && (now - lastEmission < 150 || change < 2)) return;
    lastHeading = heading;
    lastEmission = now;
    update(last.coordinates, heading);
  };

  const receivePosition = (reading: Location.LocationObject) => {
    if (!active || (last && reading.timestamp <= last.timestamp)) return;
    const { latitude, longitude, heading, speed, accuracy } = reading.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(reading.timestamp)
      || Date.now() - reading.timestamp > 30_000 || reading.timestamp > Date.now() + 5000) return;
    const sample: MovementSample = {
      coordinates: { latitude, longitude }, heading,
      speed, precision: accuracy, timestamp: reading.timestamp,
    };
    movement = movementHeading(last, sample);
    last = sample;
    emit(true);
  };
  signal?.addEventListener('abort', remove, { once: true });

  // A single continuous listener. The SDK pauses/resumes the provider when the
  // Activity changes; disabling its automatic dialog avoids pause/subscribe loops.
  void Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0,
      mayShowUserSettingsDialog: false },
    receivePosition,
    fail,
  ).then((subscription) => {
    if (active) positionSubscription = subscription;
    else subscription.remove();
  }).catch(fail);

  // One-off start with the fused provider (network/GPS): it does not wait for
  // the high-accuracy acquisition to finish, nor repeat on every render.
  void getInitialPosition().then((reading) => {
    if (!last) receivePosition(reading);
  }).catch(() => undefined);

  // A device without a compass keeps GPS tracking.
  void Location.watchHeadingAsync((reading) => {
    if (!active) return;
    orientation = compassHeading(reading);
    compassInstant = Date.now();
    emit(false);
  }, () => { orientation = null; }).then((subscription) => {
    if (active) compass = subscription;
    else subscription.remove();
  }).catch(() => { orientation = null; });

  return { remove };
}
