/** Whether the system permission dialog was already shown on this install. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'viajaya.locationGateAsked';

export async function readGateAsked(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function saveGateAsked(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.setItemAsync(KEY, '1');
  } catch {
    // Losing the flag only means the primer is shown once more.
  }
}
