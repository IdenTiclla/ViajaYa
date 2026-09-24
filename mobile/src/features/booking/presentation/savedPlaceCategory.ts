/**
 * Presentation metadata of each saved place category: the Ionicons
 * icon and the readable label. Centralized so the list, the form
 * and the search shortcuts show the same thing.
 */
import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';

import type { SavedPlaceCategory } from '@/features/booking/domain/types';

type IconName = IoniconsIconName;

type CategoryMeta = {
  /** Readable label (also the default name when creating). */
  label: string;
  icon: IconName;
};

export const CATEGORY_META: Record<SavedPlaceCategory, CategoryMeta> = {
  home: { label: 'Casa', icon: 'home' },
  work: { label: 'Trabajo', icon: 'briefcase' },
  gym: { label: 'Gimnasio', icon: 'barbell' },
  other: { label: 'Otro', icon: 'bookmark' },
};

/** Order in which the categories are offered in the form's selector. */
export const CATEGORY_ORDER: SavedPlaceCategory[] = ['home', 'work', 'gym', 'other'];
