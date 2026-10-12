/**
 * Position acquisition without failure states.
 *
 * Order: stored fix → last-known/fresh position → a light watcher that stays alive until the
 * first fresh fix. A slow start only moves `locating → weak`; a late fix moves it to `ready`
 * on its own. Nothing here exposes a retry, because the search never stops.
 */
import * as Location from 'expo-location';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { Coordinates } from '@/core/domain/geo';
import { locationService } from '@/features/home/data/locationService';
import { readLastKnownLocation, saveLastKnownLocation } from '../data/lastKnownLocation';
import { INITIAL_FIX, reduceFix, type FixState } from '../domain/fixState';
import { STORED_FIX_MAX_ACCURACY_METERS } from '../domain/storedFix';

/** Without any fix after this long, the chip says the signal is weak. */
const WEAK_AFTER_MS = 12_000;
const MAX_FIX_AGE_MS = 30_000;

export type LocationFix = FixState & {
  /** Asks for a fresh fix without clearing the position on screen. */
  refresh: () => void;
};

function isUsableReading(reading: Location.LocationObject): boolean {
  const { latitude, longitude } = reading.coords;
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    && Number.isFinite(reading.timestamp)
    && Date.now() - reading.timestamp <= MAX_FIX_AGE_MS
    && reading.timestamp <= Date.now() + 5_000;
}

/** `enabled` is the gate's `usable`: nothing is requested while the location cannot work. */
export function useLocationFix(enabled: boolean): LocationFix {
  const [fix, dispatch] = useReducer(reduceFix, INITIAL_FIX);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let hasFreshFix = false;
    let watcher: Location.LocationSubscription | null = null;
    dispatch({ type: 'reset' });

    const accept = (coordinates: Coordinates, isEstimated: boolean, accuracy: number | null) => {
      if (!active) return;
      dispatch({ type: 'position', coordinates, isEstimated, accuracy });
      if (isEstimated) return;
      hasFreshFix = true;
      watcher?.remove();
      watcher = null;
      if (accuracy == null || accuracy <= STORED_FIX_MAX_ACCURACY_METERS) {
        void saveLastKnownLocation(coordinates);
      }
    };

    const requestPosition = () => {
      void locationService.getCurrentLocation((update) => {
        if (update.status === 'granted') accept(update.coordinates, update.isEstimated, null);
      }).then((result) => {
        if (result.status === 'granted') accept(result.coordinates, result.isEstimated, null);
      }).catch(() => undefined); // The watcher and the weak-signal chip keep going.
    };
    refreshRef.current = () => { if (active) requestPosition(); };

    void readLastKnownLocation().then((stored) => {
      if (active && stored && !hasFreshFix) dispatch({ type: 'cached', coordinates: stored });
    });
    requestPosition();

    // Light watcher (no continuous high-accuracy GPS): a late signal recovers the map.
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 0,
        mayShowUserSettingsDialog: false },
      (reading) => {
        if (!isUsableReading(reading)) return;
        accept(
          { latitude: reading.coords.latitude, longitude: reading.coords.longitude },
          false,
          reading.coords.accuracy,
        );
      },
      () => undefined,
    ).then((subscription) => {
      if (!active || hasFreshFix) subscription.remove();
      else watcher = subscription;
    }).catch(() => undefined);

    const weakTimer = setTimeout(() => dispatch({ type: 'slow' }), WEAK_AFTER_MS);

    return () => {
      active = false;
      clearTimeout(weakTimer);
      watcher?.remove();
      watcher = null;
      refreshRef.current = () => undefined;
    };
  }, [enabled]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...fix, refresh };
}
