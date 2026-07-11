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
  {
    label,
    leadingIcon,
    password = false,
    error,
    style,
    onFocus,
    onBlur,
    editable = true,
    accessibilityLabel,
    placeholder,
    ...rest
  },
  ref,
) {
  const [hidden, setHidden] = useState(password);
  const [focused, setFocused] = useState(false);
  const iconColor = error ? colors.danger : focused ? colors.primary : colors.placeholder;

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          error && styles.fieldError,
          !editable && styles.fieldDisabled,
        ]}>
        {leadingIcon && (
          <Ionicons name={leadingIcon} size={20} color={iconColor} style={styles.lead} />
        )}
        <TextInput
          ref={ref}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
          placeholderTextColor={colors.placeholder}
          placeholder={placeholder}
          secureTextEntry={hidden}
          editable={editable}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, style]}
          {...rest}
        />
        {password && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar contraseña' : 'Ocultar contraseña'}
            onPress={() => setHidden((v) => !v)}
            style={styles.passwordButton}>
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={iconColor}
            />
          </TouchableOpacity>
        )}
      </View>
      {error && (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      )}
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
  fieldFocused: { borderColor: colors.primary, backgroundColor: colors.surface },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { opacity: 0.55 },
  lead: { marginRight: spacing.sm },
  input: { flex: 1, fontSize: fontSize.md, color: colors.text },
  passwordButton: {
    width: 40,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  error: { fontSize: fontSize.xs, color: colors.danger },
});
