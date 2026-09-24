/**
 * Pin fixed at the center of the map: the user moves the map underneath and the pin
 * always marks the geographic center (which matches the camera center).
 * It does not capture touches (`pointerEvents="none"`) so it does not interfere with the
 * map gesture. The tip of the stem is anchored at 50% of the map, regardless of the
 * label's height or the text size chosen on the phone.
 */
import { StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { PinLoadingIndicator } from '@/shared/components/PinLoadingIndicator';
import { MapPointBadge, type MapPointKind } from '@/shared/components/map/MapPointBadge';

export function CenterPin({
  label,
  kind = 'origin',
  loading = false,
}: {
  label: string;
  kind?: MapPointKind;
  loading?: boolean;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const color = kind === 'destination' ? colors.danger : colors.primary;
  const name = kind === 'origin' ? 'Origen' : kind === 'destination' ? 'Destino' : 'Lugar';
  return (
    <View
      style={styles.overlay}
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name}. ${label}`}
      accessibilityState={{ busy: loading }}>
      <View style={styles.callout}>
        <PinLoadingIndicator loading={loading} color={colors.surface} compact />
        <Text style={styles.calloutText} numberOfLines={2} ellipsizeMode="tail">
          {label}
        </Text>
      </View>
      <MapPointBadge kind={kind} size={32} border={2} letterSize={17} />
      <View style={[styles.stem, { backgroundColor: color }]}>
        <View style={[styles.exactPoint, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '50%',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  stem: { width: 2, height: 14, alignItems: 'center' },
  exactPoint: {
    position: 'absolute', bottom: -4, width: 8, height: 8,
    borderRadius: 4, borderWidth: 1.5, borderColor: colors.surface,
  },
  callout: {
    maxWidth: '100%',
    backgroundColor: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  calloutText: {
    flexShrink: 1,
    color: colors.surface,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
