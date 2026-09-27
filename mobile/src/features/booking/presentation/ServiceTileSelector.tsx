/**
 * Service picker of the trip configuration sheet: one illustrated tile per
 * service, with a check badge on the selected one. With large text it falls back
 * to two columns so every label stays whole.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { SERVICE_OPTIONS } from '@/features/booking/domain/serviceCatalog';
import type { ServiceType } from '@/features/booking/domain/types';
import { getTripOptionIcon } from '@/features/booking/presentation/tripOptionIcons';

type Props = {
  value: ServiceType;
  onChange: (service: ServiceType) => void;
  disabled?: boolean;
};

const TILE_SIZE = 62;

export function ServiceTileSelector({ value, onChange, disabled = false }: Props) {
  const { colors, styles, focusStyle, mode } = useThemedStyles(createStyles);
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState<ServiceType | null>(null);
  const twoColumns = fontScale > 1.3;

  return (
    <View style={[styles.grid, twoColumns && styles.gridWrap]} accessibilityRole="radiogroup"
      accessibilityLabel="Tipo de servicio">
      {SERVICE_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            style={({ pressed }) => [
              styles.option,
              twoColumns && styles.optionHalf,
              pressed && styles.pressed,
              focused === option.id && focusStyle,
            ]}
            disabled={disabled}
            onPress={() => { if (!selected) onChange(option.id); }}
            onFocus={() => setFocused(option.id)}
            onBlur={() => setFocused(null)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            aria-checked={selected}
            accessibilityLabel={option.label}>
            <View style={[styles.tile, selected && styles.tileSelected]}>
              <Image source={getTripOptionIcon(option.id, mode)} style={styles.icon} accessible={false} />
              {selected && (
                <View style={styles.check}>
                  <Ionicons name="checkmark" size={12} color={colors.textOnPrimary} accessible={false} />
                </View>
              )}
            </View>
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={2}>
              {option.shortLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  grid: { flexDirection: 'row', gap: spacing.xs },
  gridWrap: { flexWrap: 'wrap', rowGap: spacing.sm },
  option: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  optionHalf: { flexBasis: '45%' },
  pressed: { opacity: 0.85 },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: { backgroundColor: colors.warningSoft, borderColor: colors.primary },
  icon: { width: 38, height: 38 },
  check: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
  },
  label: {
    fontSize: fontSize.xs + 1,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  labelSelected: { fontWeight: fontWeight.bold, color: colors.text },
});
