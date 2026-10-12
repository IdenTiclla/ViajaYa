/**
 * Renders the intercept screen when the location cannot be used, otherwise its children.
 * The host screen owns `useLocationGate` (one poller per screen) and passes it down.
 */
import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';

import { useHideTabBar } from '@/core/components/tabBarVisibility';
import { useSwitchAccountMode } from '@/features/driver/application/useDriverAccount';
import type { LocationGate as LocationGateModel } from '../application/useLocationGate';
import type { LocationRole } from '../domain/gateState';
import { LocationGateScreen } from './LocationGateScreen';

type Props = {
  gate: LocationGateModel;
  role: LocationRole;
  children: ReactNode;
};

export function LocationGate({ gate, role, children }: Props) {
  const switchMode = useSwitchAccountMode();
  // The intercept is full screen, as designed: no bottom bar while it is in front. Only the
  // focused tab hides it, so a gate kept mounted under another tab never hides that tab's bar.
  const focused = useIsFocused();
  const fullScreen = gate.gate.kind === 'checking' || gate.gate.kind === 'unsupported' || gate.blocking != null;
  useHideTabBar(fullScreen && focused);

  if (gate.gate.kind === 'checking') return null;

  if (gate.gate.kind === 'unsupported') {
    return (
      <LocationGateScreen
        kind="unsupported"
        role={role}
        busy={switchMode.isPending}
        onPrimary={() => switchMode.mutate({ mode: 'passenger' })}
      />
    );
  }

  if (gate.blocking) {
    const kind = gate.blocking;
    return (
      <LocationGateScreen
        kind={kind}
        role={role}
        busy={gate.busy}
        onPrimary={() => gate.runPrimary(kind)}
        onSecondary={role === 'passenger' ? gate.dismissForSession : undefined}
      />
    );
  }

  return <>{children}</>;
}
