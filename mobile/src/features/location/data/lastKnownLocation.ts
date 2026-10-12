/** Persisted last accepted fix, so a cold start opens the map on the previous position. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Coordinates } from '@/core/domain/geo';
import {
  parseStoredFix,
  serializeFix,
  STORED_FIX_MAX_AGE_MS,
  STORED_FIX_SAVE_INTERVAL_MS,
} from '../domain/storedFix';

const KEY = 'viajaya.lastFix';
let lastSavedAt = 0;

/** `maxAgeMs` is `Infinity` for manual mode, where the fix is only a map center. */
export async function readLastKnownLocation(
  maxAgeMs: number = STORED_FIX_MAX_AGE_MS,
): Promise<Coordinates | null> {
  if (Platform.OS === 'web') return null;
  try {
    return parseStoredFix(await SecureStore.getItemAsync(KEY), Date.now(), maxAgeMs)?.coordinates ?? null;
  } catch {
    return null;
  }
}

/** Throttled: the continuous GPS must not write to the keystore on every fix. */
export async function saveLastKnownLocation(coordinates: Coordinates): Promise<void> {
  if (Platform.OS === 'web') return;
  const now = Date.now();
  if (now - lastSavedAt < STORED_FIX_SAVE_INTERVAL_MS) return;
  lastSavedAt = now;
  try {
    await SecureStore.setItemAsync(KEY, serializeFix(coordinates, now));
  } catch {
    // A failed write only costs the warm start of the next launch.
  }
}
