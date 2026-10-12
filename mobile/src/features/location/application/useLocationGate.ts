/**
 * Location gate for one screen: which intercept screen to show (if any), the mid-session
 * banner, and the actions that fix each cause. All state is shared through the store.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { useStore } from 'zustand';

import {
  isLocationUsable,
  resolveGateState,
  type BlockingGateKind,
  type LocationBannerCause,
  type LocationGateState,
  type LocationRole,
} from '../domain/gateState';
import { locationGateStore } from './locationGate';

/** The phone's location switch can change from the quick panel without any app event. */
const SERVICES_POLL_MS = 1500;

export type LocationGate = {
  gate: LocationGateState;
  /** Set when the screen must show the full-screen intercept. */
  blocking: BlockingGateKind | null;
  /** Mid-session / manual-mode banner. */
  banner: LocationBannerCause | null;
  /** A position can be requested right now. */
  usable: boolean;
  busy: boolean;
  /** Runs the button of the current intercept screen. */
  runPrimary: (kind: BlockingGateKind) => void;
  /** Passenger only: «Ahora no». */
  dismissForSession: () => void;
  /** Tap on the banner (or on a «my location» button without a position). */
  fixBanner: (cause: LocationBannerCause) => void;
};

export function useLocationGate(role: LocationRole): LocationGate {
  const store = useStore(locationGateStore);

  useEffect(() => { void locationGateStore.getState().init(); }, []);

  // While a screen that needs location is in front: re-read when the app comes back from
  // Settings, and watch the location switch (the quick panel does not background the app).
  useFocusEffect(
    useCallback(() => {
      const state = locationGateStore.getState();
      void state.refresh();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void locationGateStore.getState().pollServices();
      }, SERVICES_POLL_MS);
      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') void locationGateStore.getState().refresh();
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, []),
  );

  const { snapshot, askedThisInstall, capability, session, busy, loaded } = store;
  const resolution = useMemo(
    () => resolveGateState(loaded ? snapshot : null, askedThisInstall, capability, role, session),
    [loaded, snapshot, askedThisInstall, capability, role, session],
  );

  const { gate, banner } = resolution;
  const blocking: BlockingGateKind | null =
    gate.kind === 'primer' || gate.kind === 'denied' || gate.kind === 'blocked' || gate.kind === 'services-off'
      ? gate.kind
      : null;

  const runPrimary = useCallback((kind: BlockingGateKind) => {
    const actions = locationGateStore.getState();
    if (kind === 'blocked') void actions.openAppSettings();
    else if (kind === 'services-off') void actions.openLocationSettings();
    else void actions.requestPermission();
  }, []);

  const fixBanner = useCallback((cause: LocationBannerCause) => {
    const actions = locationGateStore.getState();
    if (cause === 'permission-blocked') void actions.openAppSettings();
    else if (cause === 'services-off') void actions.openLocationSettings();
    else void actions.requestPermission();
  }, []);

  const dismissForSession = useCallback(() => {
    if (role === 'passenger') locationGateStore.getState().dismiss();
  }, [role]);

  return {
    gate,
    blocking,
    banner,
    usable: isLocationUsable(loaded ? snapshot : null),
    busy,
    runPrimary,
    dismissForSession,
    fixBanner,
  };
}
