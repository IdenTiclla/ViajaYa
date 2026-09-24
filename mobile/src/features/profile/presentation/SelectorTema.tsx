import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type ThemeMode, type Theme } from '@/core/theme';
import { useThemePreference } from '@/core/theme/usePreferenciaTema';
import { Button } from '@/shared/components';

const OPTIONS = [
  { mode: 'light', title: 'Claro', detail: 'Predeterminado', icon: 'sunny-outline' },
  { mode: 'dark', title: 'Oscuro', detail: 'Fondos oscuros', icon: 'moon-outline' },
] as const;

/** The same preference is available in both roles' profiles. */
export function ThemeSelector() {
  const { colors, styles, focusStyle } = useThemedStyles(createStyles);
  const { mode, choose, loaded, saving, error } = useThemePreference();
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState<ThemeMode | null>(null);
  const inColumn = fontScale > 1.3;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>Apariencia</Text>
      <Text style={styles.hint}>Elige el tema de ViajaYa en este teléfono.</Text>
      <View style={[styles.options, inColumn && styles.column]} accessibilityRole="radiogroup" accessibilityLabel="Tema de la aplicación">
        {OPTIONS.map((option) => {
          const selected = mode === option.mode;
          return (
            <Pressable
              key={option.mode}
              onPress={() => { void choose(option.mode); }}
              disabled={!loaded || saving}
              onFocus={() => setFocused(option.mode)}
              onBlur={() => setFocused(null)}
              accessibilityRole="radio"
              accessibilityLabel={`Tema ${option.title.toLowerCase()}`}
              accessibilityHint={option.mode === 'light' ? 'Tema predeterminado de ViajaYa.' : 'Usa fondos oscuros en la aplicación.'}
              accessibilityState={{ checked: selected, disabled: !loaded || saving }}
              aria-checked={selected}
              style={({ pressed }) => [
                styles.option,
                !inColumn && styles.optionInRow,
                selected && styles.selected,
                pressed && styles.pressed,
                focused === option.mode && focusStyle,
              ]}>
              <View style={styles.icons}>
                <Ionicons accessible={false} name={option.icon} size={24} color={selected ? colors.primary : colors.textSecondary} />
                <Ionicons accessible={false} name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.controlBorder} />
              </View>
              <Text style={styles.name}>{option.title}</Text>
              <Text style={styles.detail}>{option.detail}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint} accessibilityLiveRegion="polite">
        {!loaded ? 'Cargando tu preferencia…' : saving ? 'Guardando tema…' : error ? 'Puedes seguir usando este tema.' : 'Se conserva al volver a abrir la app.'}
      </Text>
      {error && (
        <View style={styles.error}>
          <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
          <Button title="Guardar tema de nuevo" variant="secondary" disabled={saving} onPress={() => { void choose(mode); }} />
        </View>
      )}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  section: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.lg },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary },
  options: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  column: { flexDirection: 'column' },
  option: { minHeight: 96, gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: radius.md, backgroundColor: colors.surface },
  optionInRow: { flex: 1, minWidth: 0 },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.85 },
  icons: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  detail: { color: colors.textSecondary, fontSize: fontSize.xs },
  error: { gap: spacing.sm },
  errorText: { color: colors.danger, fontSize: fontSize.sm },
});
