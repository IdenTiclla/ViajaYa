/**
 * Metadatos de presentación de cada categoría de lugar guardado: el ícono de
 * Ionicons y la etiqueta legible. Centralizado para que la lista, el formulario
 * y los atajos de la búsqueda muestren lo mismo.
 */
import type { Ionicons } from '@expo/vector-icons';

import type { SavedPlaceCategory } from '@/features/booking/domain/types';

type IconName = keyof typeof Ionicons.glyphMap;

type CategoryMeta = {
  /** Etiqueta legible (también nombre por defecto al crear). */
  label: string;
  icon: IconName;
};

export const CATEGORY_META: Record<SavedPlaceCategory, CategoryMeta> = {
  home: { label: 'Casa', icon: 'home' },
  work: { label: 'Trabajo', icon: 'briefcase' },
  gym: { label: 'Gimnasio', icon: 'barbell' },
  other: { label: 'Otro', icon: 'bookmark' },
};

/** Orden en que se ofrecen las categorías en el selector del formulario. */
export const CATEGORY_ORDER: SavedPlaceCategory[] = ['home', 'work', 'gym', 'other'];
