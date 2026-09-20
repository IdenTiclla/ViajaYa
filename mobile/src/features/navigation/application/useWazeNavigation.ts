import { useRef, useState } from 'react';
import { openWaze } from '../data/wazeNavigation';
import type { NavigationTarget } from '../domain/navigationTarget';

export function useWazeNavigation(target: NavigationTarget | null, beforeOpen?: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  return { error, opening, open: async () => {
    if (!target || busy.current) return;
    busy.current = true; setOpening(true); setError(null);
    try { await beforeOpen?.(); await openWaze(target); }
    catch { setError('No pudimos abrir Waze. Reintenta o usa la navegación integrada.'); }
    finally { busy.current = false; setOpening(false); }
  } };
}
