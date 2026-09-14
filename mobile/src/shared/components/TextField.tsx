import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';

import { controles, fontSize, radius, spacing, useEstilos, type Tema } from '@/core/theme';

type Props = TextInputProps & {
  label?: string;
  /** Ícono de Ionicons a la izquierda (sobre el diseño Stitch: mail, lock-closed…). */
  leadingIcon?: IoniconsIconName;
  /** Activa el toggle de mostrar/ocultar contraseña. */
  password?: boolean;
  /** Texto fijo antes del valor (p. ej. el código de país "+591"). */
  prefix?: string;
  error?: string;
};

export const TextField = forwardRef<TextInput, Props>(function TextField(
  {
    label,
    leadingIcon,
    password = false,
    prefix,
    error,
    style,
    onFocus,
    onBlur,
    editable = true,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState,
    placeholder,
    ...rest
  },
  ref,
) {
  const { colors, styles } = useEstilos(crearEstilos);
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
          <Ionicons accessible={false} name={leadingIcon} size={20} color={iconColor} style={styles.lead} />
        )}
        {prefix && <Text accessible={false} style={styles.prefix}>{prefix}</Text>}
        <TextInput
          ref={ref}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
          accessibilityHint={[error, accessibilityHint].filter(Boolean).join('. ') || undefined}
          accessibilityState={{ ...accessibilityState, disabled: !editable }}
          aria-disabled={!editable}
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
            accessibilityState={{ disabled: !editable }}
            disabled={!editable}
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

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '500' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bordeControl,
    paddingHorizontal: spacing.sm + spacing.xs,
    minHeight: controles.altoMinimo,
  },
  fieldFocused: { borderColor: colors.primary, backgroundColor: colors.surface },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { backgroundColor: colors.fondoDeshabilitado },
  lead: { marginRight: spacing.sm },
  prefix: { marginRight: spacing.sm, fontSize: fontSize.md, color: colors.text, fontWeight: '500' },
  input: { flex: 1, minWidth: 0, minHeight: controles.altoMinimo - 2, paddingVertical: spacing.sm, fontSize: fontSize.md, color: colors.text },
  passwordButton: {
    width: controles.altoMinimo,
    minHeight: controles.altoMinimo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  error: { flexShrink: 1, fontSize: fontSize.sm, color: colors.danger },
});
