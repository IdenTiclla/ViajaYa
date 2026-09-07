import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useEstilos } from '@/core/theme';

type Props = {
  loading: boolean;
  color?: string;
  compact?: boolean;
};

/**
 * Slot estable para indicar que un pin está resolviendo su dirección.
 *
 * El `ActivityIndicator` permanece montado incluso al terminar. Esto evita
 * insertar o quitar hijos dentro de los marcadores personalizados de Maps,
 * una operación especialmente frágil con Fabric en Android.
 */
export function PinLoadingIndicator({
  loading,
  color,
  compact = false,
}: Props) {
  const { colors, styles } = useEstilos(crearEstilos);
  return (
    <View
      style={[styles.slot, compact && styles.slotCompact]}
      pointerEvents="none"
      accessibilityElementsHidden>
      <ActivityIndicator
        animating={loading}
        color={color ?? colors.primary}
        size="small"
        style={[
          styles.indicator,
          compact && styles.indicatorCompact,
          !loading && styles.hidden,
        ]}
      />
    </View>
  );
}

const crearEstilos = () => StyleSheet.create({
  slot: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCompact: { width: 12, height: 12 },
  indicator: { position: 'absolute' },
  indicatorCompact: { transform: [{ scale: 0.62 }] },
  hidden: { opacity: 0 },
});
