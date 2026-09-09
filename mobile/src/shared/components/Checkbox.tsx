import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { controles, fontSize, radius, spacing, useEstilos, type Tema } from '@/core/theme';

type Props = {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Contenido a la derecha (texto o nodos como enlaces). */
  children: React.ReactNode;
  error?: string;
  disabled?: boolean;
};

export function Checkbox({ checked, onChange, children, error, disabled = false }: Props) {
  const { colors, styles, estiloFoco } = useEstilos(crearEstilos);
  const [enfocado, setEnfocado] = useState(false);
  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        aria-checked={checked}
        aria-disabled={disabled}
        disabled={disabled}
        onFocus={() => setEnfocado(true)}
        onBlur={() => setEnfocado(false)}
        onPress={() => onChange(!checked)}
        style={({ pressed }) => [
          styles.row,
          pressed && styles.pressed,
          disabled && styles.disabled,
          enfocado && estiloFoco,
        ]}>
        <View style={[styles.box, checked && styles.boxChecked]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  wrapper: { gap: spacing.xs },
  row: {
    minHeight: controles.altoMinimo,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: { opacity: 0.92 },
  disabled: { backgroundColor: colors.fondoDeshabilitado, borderRadius: radius.sm },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.bordeControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  error: { fontSize: fontSize.xs, color: colors.danger },
});
