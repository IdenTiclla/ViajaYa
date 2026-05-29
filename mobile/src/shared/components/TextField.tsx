import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, fontSize, radius, spacing } from '@/core/theme';

type Props = TextInputProps & {
  label?: string;
  /** Ícono de Ionicons a la izquierda (sobre el diseño Stitch: mail, lock-closed…). */
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  /** Activa el toggle de mostrar/ocultar contraseña. */
  password?: boolean;
  error?: string;
};

export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, leadingIcon, password = false, error, style, ...rest },
  ref,
) {
  const [hidden, setHidden] = useState(password);

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.field, error ? styles.fieldError : null]}>
        {leadingIcon && (
          <Ionicons name={leadingIcon} size={20} color={colors.placeholder} style={styles.lead} />
        )}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={hidden}
          style={[styles.input, style]}
          {...rest}
        />
        {password && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar contraseña' : 'Ocultar contraseña'}
            onPress={() => setHidden((v) => !v)}
            hitSlop={8}>
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.placeholder}
            />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '500' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: spacing.md,
    height: 54,
  },
  fieldError: { borderColor: colors.danger },
  lead: { marginRight: spacing.sm },
  input: { flex: 1, fontSize: fontSize.md, color: colors.text },
  error: { fontSize: fontSize.xs, color: colors.danger },
});
