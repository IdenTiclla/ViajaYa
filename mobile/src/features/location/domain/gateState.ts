/**
 * Location gate state machine (pure).
 *
 * Decides which screen the intercept shows from a silent snapshot of the device:
 * permission, whether the provider is on, whether the device can locate at all and
 * what the person already did this session. Nothing here touches the SDK.
 */

export type PermissionSnapshot = {
  status: 'undetermined' | 'denied' | 'granted';
  canAskAgain: boolean;
  /** `Location.hasServicesEnabledAsync()`: the phone's location switch. */
  servicesEnabled: boolean;
};

export type LocationRole = 'passenger' | 'driver';

/** Hardware capability only: says nothing about permission or the GPS switch. */
export type LocationCapability = 'capable' | 'none';

/** In memory only. It resets on every cold start, which is what brings the gate back. */
export type GateSession = {
  /** The gate already resolved once (open or dismissed): later losses show a banner. */
  entryDone: boolean;
  /** The passenger tapped «Ahora no». */
  dismissed: boolean;
};

export type BlockingGateKind = 'primer' | 'denied' | 'blocked' | 'services-off';

export type LocationGateState =
  | { kind: 'checking' }
  | { kind: BlockingGateKind }
  | { kind: 'manual'; reason: 'dismissed' | 'no-capability' }
  | { kind: 'unsupported' }
  | { kind: 'open' };

export type LocationBannerCause = 'services-off' | 'permission-denied' | 'permission-blocked';

export type GateResolution = {
  gate: LocationGateState;
  banner: LocationBannerCause | null;
};

export const INITIAL_GATE_SESSION: GateSession = { entryDone: false, dismissed: false };

/** True when a position can be requested right now. */
export function isLocationUsable(snapshot: PermissionSnapshot | null): boolean {
  return snapshot != null && snapshot.status === 'granted' && snapshot.servicesEnabled;
}

/** The single cause that stops the location, or `null` when it is usable. */
export function blockingKind(
  snapshot: PermissionSnapshot,
  askedThisInstall: boolean,
): BlockingGateKind | null {
  if (snapshot.status === 'granted') return snapshot.servicesEnabled ? null : 'services-off';
  if (!snapshot.canAskAgain) return 'blocked';
  if (snapshot.status === 'undetermined') return 'primer';
  // Denied but still askable: the denied screen only makes sense after the person
  // actually saw the system dialog once.
  return askedThisInstall ? 'denied' : 'primer';
}

export function bannerCauseFor(kind: BlockingGateKind): LocationBannerCause {
  if (kind === 'services-off') return 'services-off';
  if (kind === 'blocked') return 'permission-blocked';
  return 'permission-denied';
}

export function resolveGateState(
  snapshot: PermissionSnapshot | null,
  askedThisInstall: boolean,
  capability: LocationCapability,
  role: LocationRole,
  session: GateSession,
): GateResolution {
  // A device that cannot locate has nothing to fix: no gate and no banner.
  if (capability === 'none') {
    return {
      gate: role === 'driver' ? { kind: 'unsupported' } : { kind: 'manual', reason: 'no-capability' },
      banner: null,
    };
  }
  if (!snapshot) return { gate: { kind: 'checking' }, banner: null };

  // A usable snapshot always wins, even over a dismissal.
  const kind = blockingKind(snapshot, askedThisInstall);
  if (kind == null) return { gate: { kind: 'open' }, banner: null };

  const banner = bannerCauseFor(kind);
  if (role === 'passenger' && session.dismissed) {
    return { gate: { kind: 'manual', reason: 'dismissed' }, banner };
  }
  // Mid-session loss: the app is already in use, so never interrupt with a full screen.
  if (session.entryDone) return { gate: { kind: 'open' }, banner };
  return { gate: { kind }, banner: null };
}
