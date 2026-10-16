/** The app-wide gate store, wired to the real platform. */
import { readGateAsked, saveGateAsked } from '../data/gateStorage';
import { readLocationCapability } from '../data/locationCapability';
import {
  openAppSettings,
  openLocationSettings,
  readPermissionSnapshot,
  readServicesEnabled,
  requestForegroundPermission,
} from '../data/locationPermission';
import { createLocationGateStore } from './createLocationGateStore';

export const locationGateStore = createLocationGateStore({
  readSnapshot: readPermissionSnapshot,
  readServicesEnabled,
  requestPermission: requestForegroundPermission,
  readAsked: readGateAsked,
  saveAsked: saveGateAsked,
  readCapability: readLocationCapability,
  openAppSettings,
  openLocationSettings,
});
