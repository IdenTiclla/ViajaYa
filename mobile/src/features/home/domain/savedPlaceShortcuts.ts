import type { SavedPlace } from '@/features/booking/domain/types';

/**
 * One shortcut of the Home "Lugares guardados" row. Home and Work always
 * appear: when missing they invite the passenger to set them.
 */
export type SavedPlaceShortcut =
  | { kind: 'saved'; key: string; place: SavedPlace }
  | { kind: 'unset'; key: string; category: 'home' | 'work' };

/** Home and Work first (saved or pending), then the other favorites in API order. */
export function buildSavedPlaceShortcuts(places: SavedPlace[]): SavedPlaceShortcut[] {
  const home = places.find((p) => p.category === 'home');
  const work = places.find((p) => p.category === 'work');
  const pinned: SavedPlaceShortcut[] = [
    home ? { kind: 'saved', key: home.id, place: home } : { kind: 'unset', key: 'unset-home', category: 'home' },
    work ? { kind: 'saved', key: work.id, place: work } : { kind: 'unset', key: 'unset-work', category: 'work' },
  ];
  const others: SavedPlaceShortcut[] = places
    .filter((p) => p !== home && p !== work)
    .map((p) => ({ kind: 'saved', key: p.id, place: p }));
  return [...pinned, ...others];
}
