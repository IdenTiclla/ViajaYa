/**
 * Position acquisition as phases, never as an error.
 *
 * `weak` only means that nothing arrived yet; the search keeps running and a late fix
 * moves it to `ready` on its own.
 */
import type { Coordinates } from '@/core/domain/geo';

export type FixState = {
  phase: 'locating' | 'ready' | 'weak';
  coordinates: Coordinates | null;
  /** The coordinates come from a stored or last-known position, not a fresh fix. */
  isEstimated: boolean;
  accuracy: number | null;
};

export type FixEvent =
  | { type: 'reset' }
  | { type: 'cached'; coordinates: Coordinates }
  | { type: 'position'; coordinates: Coordinates; isEstimated: boolean; accuracy: number | null }
  | { type: 'slow' };

export const INITIAL_FIX: FixState = {
  phase: 'locating',
  coordinates: null,
  isEstimated: false,
  accuracy: null,
};

const hasPreciseFix = (state: FixState) => state.phase === 'ready' && !state.isEstimated;

export function reduceFix(state: FixState, event: FixEvent): FixState {
  switch (event.type) {
    case 'reset':
      // A new search keeps what the map already shows, now as a provisional position.
      return state.coordinates
        ? { phase: 'ready', coordinates: state.coordinates, isEstimated: true, accuracy: null }
        : INITIAL_FIX;
    case 'cached':
      if (hasPreciseFix(state)) return state;
      return { phase: 'ready', coordinates: event.coordinates, isEstimated: true, accuracy: null };
    case 'position':
      // A provisional position never replaces a fresh one.
      if (event.isEstimated && hasPreciseFix(state)) return state;
      return {
        phase: 'ready',
        coordinates: event.coordinates,
        isEstimated: event.isEstimated,
        accuracy: event.accuracy,
      };
    case 'slow':
      // Only the empty wait becomes `weak`: any position already shown stays.
      return state.phase === 'locating' ? { ...state, phase: 'weak' } : state;
  }
}
