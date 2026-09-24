/**
 * Continuous location hook (driver navigation): subscribes to
 * GPS and compass. Expo handles the native pause in the background; keeping the
 * subscription avoids competing with that resume and restarting the GPS acquisition.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { Coordinates } from '@/core/domain/geo';
import { locationService } from '@/features/home/data/locationService';

export type WatchStatus = 'loading' | 'granted' | 'denied' | 'disabled' | 'error';

export type WatchedPosition = {
  status: WatchStatus;
  coordinates: Coordinates | null;
  /** Movement heading or compass, in degrees from north. */
  heading: number | null;
  retry: () => void;
};

export function useWatchPosition(enabled = true): WatchedPosition {
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = useState<Omit<WatchedPosition, 'retry'>>({
    status: 'loading', coordinates: null, heading: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let subscription: { remove: () => void } | null = null;
    let cancellation: AbortController | null = null;
    let generation = 0;
    let appState = AppState.currentState;
    let starting = false;
    let hasPosition = false;
    let backgroundedAt = 0;
    let wait: ReturnType<typeof setTimeout> | undefined;

    const cancelWait = () => { clearTimeout(wait); };
    const waitForPosition = () => {
      cancelWait();
      if (hasPosition || appState === 'background') return;
      wait = setTimeout(() => {
        if (!active || hasPosition) return;
        // The listener stays alive: a late signal recovers the map.
        setPosition({ status: 'error', coordinates: null, heading: null });
      }, 15_000);
    };
    const stop = () => {
      generation += 1;
      cancelWait();
      cancellation?.abort();
      cancellation = null;
      subscription?.remove();
      subscription = null;
      starting = false;
    };
    const start = () => {
      if (!active || subscription || starting) return;
      stop();
      starting = true;
      hasPosition = false;
      const controller = new AbortController();
      cancellation = controller;
      const watchGeneration = generation;
      setPosition({ status: 'loading', coordinates: null, heading: null });
      const current = () => active && watchGeneration === generation;
      const fail = (reason: 'error' | 'disabled' = 'error') => {
        if (!current()) return;
        stop();
        setPosition({ status: reason, coordinates: null, heading: null });
      };

      void locationService
        .watchPosition((coords, hd) => {
          if (!current() || appState === 'background') return;
          hasPosition = true;
          cancelWait();
          setPosition({ status: 'granted', coordinates: coords, heading: hd });
        }, fail, controller.signal)
        .then((sub) => {
          if (!current()) {
            sub?.remove();
            return;
          }
          starting = false;
          if (sub == null) {
            cancelWait();
            setPosition({ status: 'denied', coordinates: null, heading: null });
          } else {
            subscription = sub;
            waitForPosition();
          }
        })
        .catch(() => fail());
    };
    const listener = AppState.addEventListener('change', (next) => {
      const previous = appState;
      if (next !== 'inactive') appState = next;
      if (next === 'background') {
        backgroundedAt = Date.now();
        cancelWait();
      }
      if (next !== 'active' || previous !== 'background' || starting) return;
      if (!subscription) { start(); return; }
      if (Date.now() - backgroundedAt > 30_000) {
        hasPosition = false;
        setPosition({ status: 'loading', coordinates: null, heading: null });
      }
      // Keep the healthy watcher. Only remove it if the permissions changed or
      // location was turned off while the app was in the background.
      const watchGeneration = generation;
      void locationService.checkAvailability().then((availability) => {
        if (!active || watchGeneration !== generation || appState !== 'active') return;
        if (availability !== 'granted') {
          stop();
          setPosition({ status: availability, coordinates: null, heading: null });
          return;
        }
        waitForPosition();
      }).catch(() => { /* Una consulta fallida no interrumpe un GPS activo. */ });
    });
    if (appState !== 'background') start();

    return () => {
      active = false;
      stop();
      listener.remove();
    };
  }, [attempt, enabled]);

  return {
    ...position,
    retry: () => {
      setAttempt((n) => n + 1);
    },
  };
}
