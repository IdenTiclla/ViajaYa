import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/core/theme';

type Props = {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Contenido a la derecha (texto o nodos como enlaces). */
  children: React.ReactNode;
  error?: string;
  disabled?: boolean;
};

export function Checkbox({ checked, onChange, children, error, disabled = false }: Props) {
  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        style={({ pressed }) => [
          styles.row,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}>
        <View style={[styles.box, checked && styles.boxChecked]}>
          {checked && <Ionicons name="checkmark" size={14} color={colors.textOnPrimary} />}
        </View>
        <Text style={styles.label}>{children}</Text>
      </Pressable>
      {error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  error: { fontSize: fontSize.xs, color: colors.danger },
});
