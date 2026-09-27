import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
// Imported directly: the theme barrel must stay loadable by the Node unit tests (no expo-font).
import { useBrandFontStyle } from '@/core/theme/brandFont';

const CODE_LENGTH = 6;
const CELLS = Array.from({ length: CODE_LENGTH }, (_, index) => index);

type Props = {
  value: string;
  onChangeText: (code: string) => void;
  editable?: boolean;
  error?: string;
};

/**
 * Six-cell view of the SMS code. A single transparent input covers the cells, so SMS autofill,
 * paste and the screen reader work on one real field; the cells only draw its value.
 */
export function OneTimeCodeInput({ value, onChangeText, editable = true, error }: Props) {
  const { styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  const [focused, setFocused] = useState(false);
  const label = 'Código de seis dígitos';
  return (
    <View style={styles.wrapper}>
      <Text nativeID="one-time-code-label" style={styles.label}>{label}</Text>
      <View style={[styles.row, !editable && styles.disabled]}>
        {CELLS.map((index) => {
          const active = focused && editable && index === Math.min(value.length, CODE_LENGTH - 1);
          return (
            <View key={index} style={[styles.cell, active && styles.cellActive, !!error && styles.cellError]}>
              <Text maxFontSizeMultiplier={1.6} style={[styles.digit, brandFont]}>{value[index] ?? ''}</Text>
            </View>
          );
        })}
        <TextInput value={value} onChangeText={onChangeText} editable={editable}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          maxLength={CODE_LENGTH} keyboardType="number-pad" autoComplete="one-time-code"
          textContentType="oneTimeCode" caretHidden selectionColor="transparent"
          accessibilityLabel={label} aria-labelledby="one-time-code-label"
          accessibilityHint={error} aria-invalid={!!error}
          style={styles.input} />
      </View>
      {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrapper: { gap: spacing.xs + 2 },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md + 2, borderWidth: 1.5, borderColor: colors.controlBorder, backgroundColor: colors.surface,
  },
  cellActive: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  cellError: { borderColor: colors.danger },
  digit: { fontSize: fontSize.xl - 2, fontWeight: fontWeight.bold, color: colors.text },
  // Covers the cells so any tap focuses the field; its own text is invisible.
  input: { ...StyleSheet.absoluteFill, color: 'transparent', backgroundColor: 'transparent', fontSize: 1 },
  disabled: { opacity: 0.6 },
  error: { fontSize: fontSize.sm, color: colors.danger },
});
