import type { NavigationTarget } from '../domain/navigationTarget';

export interface NavigationPort {
  requestPermission(): Promise<boolean>;
  acceptTerms(): Promise<boolean>;
  initialize(): Promise<string>;
  startLocationUpdates(): void;
  waitForLocation(): Promise<void>;
  setDestination(target: NavigationTarget): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function guarded<T>(work: Promise<T>, signal: AbortSignal, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => finish(() => reject(new Error('cancelled')));
    const timer = setTimeout(() => finish(() => reject(new Error('LOCATION_UNKNOWN'))), timeoutMs);
    function finish(action: () => void) {
      clearTimeout(timer); signal.removeEventListener('abort', cancel); action();
    }
    signal.addEventListener('abort', cancel, { once: true });
    work.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal.aborted) cancel();
  });
}

/** Owns one native session. GPS arrival never mutates the business trip state. */
export async function runNavigationSession(port: NavigationPort, target: NavigationTarget,
  signal: AbortSignal, onReady: () => void): Promise<void> {
  const check = () => { if (signal.aborted) throw new Error('cancelled'); };
  try {
    check();
    if (!await guarded(port.requestPermission(), signal, 60_000)) throw new Error('locationPermissionMissing');
    check();
    if (!await guarded(port.acceptTerms(), signal, 60_000)) throw new Error('termsNotAccepted');
    check();
    const initialized = await guarded(port.initialize(), signal);
    if (initialized !== 'ok') throw new Error(initialized);
    check();
    // Registering a JS callback does not start the native location provider.
    port.startLocationUpdates();
    await guarded(port.waitForLocation(), signal);
    check();
    const route = await guarded(port.setDestination(target), signal);
    if (route !== 'OK') throw new Error(route);
    check();
    await guarded(port.start(), signal);
    check(); onReady();
    await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); if (signal.aborted) resolve(); });
  } finally { await port.stop(); }
}
