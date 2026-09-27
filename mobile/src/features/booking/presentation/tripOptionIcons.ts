/**
 * Duotone icons of the trip configuration (services and payment methods).
 *
 * They ship as PNGs because the app has no SVG renderer; each theme has its own
 * set so the strokes keep their contrast. Regenerate them with
 * `scripts/render_trip_option_icons.py`.
 */
import type { ImageSourcePropType } from 'react-native';

import type { ThemeMode } from '@/core/theme';

export type TripOptionIconName = 'taxi' | 'moto' | 'delivery' | 'moving' | 'cash' | 'qr';

const ICONS: Record<ThemeMode, Record<TripOptionIconName, ImageSourcePropType>> = {
  light: {
    taxi: require('@/assets/images/trip-options/taxi-light.png'),
    moto: require('@/assets/images/trip-options/moto-light.png'),
    delivery: require('@/assets/images/trip-options/delivery-light.png'),
    moving: require('@/assets/images/trip-options/moving-light.png'),
    cash: require('@/assets/images/trip-options/cash-light.png'),
    qr: require('@/assets/images/trip-options/qr-light.png'),
  },
  dark: {
    taxi: require('@/assets/images/trip-options/taxi-dark.png'),
    moto: require('@/assets/images/trip-options/moto-dark.png'),
    delivery: require('@/assets/images/trip-options/delivery-dark.png'),
    moving: require('@/assets/images/trip-options/moving-dark.png'),
    cash: require('@/assets/images/trip-options/cash-dark.png'),
    qr: require('@/assets/images/trip-options/qr-dark.png'),
  },
};

export function getTripOptionIcon(name: TripOptionIconName, mode: ThemeMode): ImageSourcePropType {
  return ICONS[mode][name];
}
