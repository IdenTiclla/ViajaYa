/**
 * Seconds left until a target instant (ISO), updated every second.
 *
 * Returns `null` when there is no target; never goes below 0. Useful for lifetime
 * countdowns (e.g. a ride request's negotiation window). The value is
 * computed during render from a ticking clock, so setState is not called
 * synchronously inside the effect.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useCountdown(target: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    // When returning to the foreground the interval may have been frozen: recompute
    // so a stale countdown is not shown.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [target]);

  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1000));
}
