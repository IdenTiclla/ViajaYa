import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useThemedStyles } from '@/core/theme';

type Props = {
  loading: boolean;
  color?: string;
  compact?: boolean;
};

/**
 * Stable slot to show that a pin is resolving its address.
 *
 * The `ActivityIndicator` stays mounted even when done. This avoids
 * inserting or removing children inside custom Maps markers,
 * an especially fragile operation with Fabric on Android.
 */
export function PinLoadingIndicator({
  loading,
  color,
  compact = false,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
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

const createStyles = () => StyleSheet.create({
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
