import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, spacing, useEstilos, type Tema } from '@/core/theme';

type Props = { prompt?: string; label: string; onPress: () => void; disabled?: boolean };

/** Text-style call to action ("¿No tienes cuenta? Regístrate") with a 48 px touch target. */
export function AuthLink({ prompt, label, onPress, disabled }: Props) {
  const { styles, estiloFoco } = useEstilos(createStyles);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={prompt ? `${prompt} ${label}` : label}
      accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} hitSlop={spacing.xs}
      style={({ pressed }) => [styles.link, pressed && styles.pressed, focused && estiloFoco]}>
      <View style={styles.row}>
        {prompt && <Text style={styles.prompt}>{prompt} </Text>}
        <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  link: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  prompt: { fontSize: fontSize.sm, color: colors.textSecondary },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  labelDisabled: { color: colors.textoDeshabilitado },
});
