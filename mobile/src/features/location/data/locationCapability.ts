/**
 * Does this device have any location hardware at all? Expo does not expose it, so a tiny
 * local native module (`modules/location-capability`) asks the package manager.
 * Without the module (older dev build, web) the device is assumed capable.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { LocationCapability } from '../domain/gateState';

type LocationCapabilityModule = { hasLocationHardware: () => boolean };

let cached: LocationCapability | null = null;

export function readLocationCapability(): LocationCapability {
  if (cached) return cached;
  let capability: LocationCapability = 'capable';
  if (Platform.OS === 'android') {
    try {
      const native = requireOptionalNativeModule<LocationCapabilityModule>('LocationCapability');
      if (native && native.hasLocationHardware() === false) capability = 'none';
    } catch {
      capability = 'capable';
    }
  }
  cached = capability;
  return capability;
}
