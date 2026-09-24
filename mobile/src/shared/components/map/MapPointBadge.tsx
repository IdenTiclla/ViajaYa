import { StyleSheet, Text, View } from 'react-native';

import { fontWeight, useThemedStyles, type Theme } from '@/core/theme';
import { PinLoadingIndicator } from '@/shared/components/PinLoadingIndicator';

export type MapPointKind = 'origin' | 'destination' | 'place';

type Props = {
  kind: MapPointKind;
  size: number;
  border: number;
  letterSize: number;
  loading?: boolean;
  dimmed?: boolean;
};

/** Shared circular pins: A for origin and B for destination. */
export function MapPointBadge({
  kind, size, border, letterSize, loading = false, dimmed = false,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderWidth: border,
          borderRadius: size / 2,
          backgroundColor: kind === 'destination' ? colors.danger : colors.primary,
          opacity: dimmed ? 0.5 : 1,
        },
      ]}>
      {/* The letter is part of the symbol; the accessible label lives on the marker. */}
      <Text
        allowFontScaling={false}
        style={[
          styles.letter,
          { fontSize: letterSize, lineHeight: size - border * 2, opacity: loading ? 0 : 1 },
        ]}>
        {kind === 'origin' ? 'A' : kind === 'destination' ? 'B' : '+'}
      </Text>
      <View style={styles.loader}>
        <PinLoadingIndicator loading={loading} color={colors.textOnPrimary} compact />
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.surface,
    shadowColor: colors.vehicleOutline,
    shadowOpacity: 0.24,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  letter: {
    color: colors.textOnPrimary,
    fontWeight: fontWeight.bold,
    includeFontPadding: false,
    textAlign: 'center',
  },
  loader: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
