import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

type Props = { termsText?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean };

/** Terms excerpt (expandable) + consent checkbox required before creating an account. */
export function TermsCheckbox({ termsText, checked, onChange, disabled }: Props) {
  const { colors, styles, focusStyle } = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.wrapper}>
      {termsText && (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}
          accessibilityLabel={expanded ? 'Ocultar condiciones' : 'Leer condiciones completas'}
          accessibilityState={{ expanded }} style={styles.terms}>
          <Text style={styles.termsText} numberOfLines={expanded ? undefined : 3}>{termsText}</Text>
          <Text style={styles.termsToggle}>{expanded ? 'Ver menos' : 'Leer todo'}</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !!disabled }}
        aria-checked={checked} disabled={disabled} onPress={() => onChange(!checked)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={[styles.row, focused && focusStyle]}>
        <View style={[styles.box, checked && styles.boxChecked]}>
          {checked && <Ionicons name="checkmark" size={16} color={colors.textOnPrimary} />}
        </View>
        <Text style={styles.label}>He leído y acepto las condiciones de uso.</Text>
      </Pressable>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrapper: { gap: spacing.sm },
  terms: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: spacing.xs },
  termsText: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  termsToggle: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, borderRadius: radius.sm },
  box: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.controlBorder,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  boxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  label: { flex: 1, fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },
});
