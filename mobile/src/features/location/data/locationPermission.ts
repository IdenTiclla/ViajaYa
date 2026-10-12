/**
 * Silent reads and the few actions the location gate needs from the system.
 * Nothing here opens a dialog unless the caller asked for one explicitly.
 */
import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import type { PermissionSnapshot } from '../domain/gateState';

/** Only the phone's location switch: cheap enough to poll. */
export async function readServicesEnabled(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

export async function readPermissionSnapshot(): Promise<PermissionSnapshot> {
  const [permission, servicesEnabled] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    readServicesEnabled(),
  ]);
  const status = permission.status === Location.PermissionStatus.GRANTED
    ? 'granted'
    : permission.status === Location.PermissionStatus.DENIED ? 'denied' : 'undetermined';
  return { status, canAskAgain: permission.canAskAgain, servicesEnabled };
}

/** Shows the system permission dialog (only when the OS can still show it). */
export async function requestForegroundPermission(): Promise<void> {
  await Location.requestForegroundPermissionsAsync();
}

export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}

/** A rejection faster than this means the system never showed its dialog. */
const DIALOG_SEEN_MS = 700;

/**
 * Turns the phone's location on with the fewest taps the platform allows.
 * Android: Google's «Activar ubicación» dialog, so the person stays in the app.
 * If that dialog cannot be shown, the location settings screen. iOS: Settings.
 */
export async function openLocationSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    await Linking.openSettings();
    return;
  }
  const startedAt = Date.now();
  try {
    await Location.enableNetworkProviderAsync();
    return;
  } catch {
    // The person answered the dialog with «No»: respect it, do not open Settings after it.
    if (Date.now() - startedAt >= DIALOG_SEEN_MS) return;
  }
  try {
    await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
  } catch {
    await Linking.openSettings();
  }
}
