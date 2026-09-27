/**
 * "Aceptar automáticamente" row of the trip configuration sheet. When it is on,
 * the backend assigns the first driver who accepts the passenger's fare without
 * waiting for them to choose; counter-offers still wait for the passenger.
 */
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { fontSize, fontWeight, spacing, useThemedStyles, type Theme } from '@/core/theme';

type Props = {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Fare already formatted for the hint (e.g. "25"); omitted while it is invalid. */
  fareLabel?: string;
};

export function AutoAcceptToggle({ value, onChange, fareLabel }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const hint = fareLabel
    ? `Viaja con el primero que diga «sí» a Bs ${fareLabel}`
    : 'Viaja con el primero que acepte tu precio';

  return (
    <Pressable
      style={styles.row}
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      aria-checked={value}
      accessibilityLabel="Aceptar automáticamente"
      accessibilityHint={hint}>
      <View style={styles.text} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.title}>Aceptar automáticamente</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.controlBorder, true: colors.primary }}
        thumbColor={value ? colors.accent : colors.surface}
        ios_backgroundColor={colors.controlBorder}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.md - 1, fontWeight: fontWeight.bold, color: colors.text },
  hint: { fontSize: fontSize.xs + 1, color: colors.textSecondary },
});
