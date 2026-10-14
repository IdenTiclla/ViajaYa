/**
 * Shared location gate store.
 *
 * One snapshot for the whole app: every screen that mounts the gate reads the same state, so two
 * screens can never open two system dialogs. Platform access is injected (`GateDeps`) to keep
 * the store testable in Node; `locationGate.ts` wires the real one.
 */
import { createStore } from 'zustand/vanilla';

import {
  INITIAL_GATE_SESSION,
  isLocationUsable,
  type GateSession,
  type LocationCapability,
  type LocationRole,
  type PermissionSnapshot,
} from '../domain/gateState';

export type GateDeps = {
  readSnapshot: () => Promise<PermissionSnapshot>;
  readServicesEnabled: () => Promise<boolean>;
  requestPermission: () => Promise<void>;
  readAsked: () => Promise<boolean>;
  saveAsked: () => Promise<void>;
  readCapability: () => LocationCapability;
  openAppSettings: () => Promise<void>;
  openLocationSettings: () => Promise<void>;
};

export type GateStoreState = {
  /** `false` until the first silent read finishes. */
  loaded: boolean;
  snapshot: PermissionSnapshot | null;
  askedThisInstall: boolean;
  capability: LocationCapability;
  session: GateSession;
  /** Role the session belongs to: switching role starts a fresh entry. */
  sessionRole: LocationRole | null;
  /** A system dialog or settings round trip is in flight. */
  busy: boolean;
  init: () => Promise<void>;
  /** Full silent re-read (permission + switch). */
  refresh: () => Promise<void>;
  /** Cheap poll of the phone's location switch; re-reads everything only on a change. */
  pollServices: () => Promise<void>;
  requestPermission: () => Promise<void>;
  openAppSettings: () => Promise<void>;
  openLocationSettings: () => Promise<void>;
  dismiss: () => void;
  /** A different role than the session's one resets the session (entry + dismissal). */
  enterRole: (role: LocationRole) => void;
};

export function createLocationGateStore(deps: GateDeps) {
  let initializing: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  let requesting: Promise<void> | null = null;
  // A read that started before a newer one finished must not overwrite it.
  let readGeneration = 0;

  return createStore<GateStoreState>((set, get) => {
    const markEntryDone = (snapshot: PermissionSnapshot) => {
      if (isLocationUsable(snapshot) && !get().session.entryDone) {
        set((state) => ({ session: { ...state.session, entryDone: true } }));
      }
    };

    // Used when the very first read fails: the primer is the one screen that offers a way
    // forward (its button re-reads), whereas a missing snapshot would leave the gate checking.
    const UNREADABLE: PermissionSnapshot = { status: 'undetermined', canAskAgain: true, servicesEnabled: false };

    // `loaded` is owned by `init`: it must not flip before the asked flag and the capability
    // are known, or the first render could resolve against defaults.
    const read = async () => {
      const generation = ++readGeneration;
      let snapshot: PermissionSnapshot;
      try {
        snapshot = await deps.readSnapshot();
      } catch (error) {
        if (generation === readGeneration && get().snapshot == null) set({ snapshot: UNREADABLE });
        throw error;
      }
      if (generation !== readGeneration) return;
      set({ snapshot });
      markEntryDone(snapshot);
    };

    return {
      loaded: false,
      snapshot: null,
      askedThisInstall: false,
      capability: 'capable',
      session: INITIAL_GATE_SESSION,
      sessionRole: null,
      busy: false,

      init: () => {
        if (get().loaded) return Promise.resolve();
        initializing ??= (async () => {
          const [asked] = await Promise.all([deps.readAsked(), read().catch(() => undefined)]);
          set({ askedThisInstall: asked, capability: deps.readCapability(), loaded: true });
        })().finally(() => { initializing = null; });
        return initializing;
      },

      refresh: () => {
        refreshing ??= read().catch(() => undefined).finally(() => { refreshing = null; });
        return refreshing;
      },

      pollServices: async () => {
        const { snapshot } = get();
        if (!snapshot || snapshot.status !== 'granted') return;
        const enabled = await deps.readServicesEnabled();
        if (enabled !== get().snapshot?.servicesEnabled) await get().refresh();
      },

      requestPermission: () => {
        requesting ??= (async () => {
          set({ busy: true, askedThisInstall: true });
          try {
            await deps.saveAsked();
            await deps.requestPermission();
          } catch {
            // The re-read below decides the next state, whatever the dialog did.
          }
          await get().refresh();
          set({ busy: false });
        })().finally(() => { requesting = null; });
        return requesting;
      },

      openAppSettings: async () => {
        try { await deps.openAppSettings(); } catch { /* AppState re-reads on return */ }
      },

      openLocationSettings: async () => {
        if (get().busy) return;
        set({ busy: true });
        try {
          await deps.openLocationSettings();
        } catch {
          // Whatever happened, the poll and the re-read below show the real state.
        }
        await get().refresh();
        set({ busy: false });
      },

      dismiss: () => {
        set((state) => ({ session: { entryDone: true, dismissed: true }, busy: state.busy }));
      },

      enterRole: (role) => {
        const { sessionRole } = get();
        if (sessionRole === role) return;
        const usable = isLocationUsable(get().snapshot);
        set({
          sessionRole: role,
          session: sessionRole == null ? get().session : { ...INITIAL_GATE_SESSION, entryDone: usable },
        });
      },
    };
  });
}
