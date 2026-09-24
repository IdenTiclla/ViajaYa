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

import { controls, fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

type Props = TextInputProps & {
  label?: string;
  /** Ionicons icon on the left (per the Stitch design: mail, lock-closed…). */
  leadingIcon?: IoniconsIconName;
  /** Enable the show/hide password toggle. */
  password?: boolean;
  /** Fixed text before the value (e.g. the country code "+591"). */
  prefix?: string;
  error?: string;
  /** Visible guidance below the field; an error takes precedence. */
  helperText?: string;
  /** For controlled fields with maxLength, display the character count. */
  showCharacterCount?: boolean;
};

export const TextField = forwardRef<TextInput, Props>(function TextField(
  {
    label,
    leadingIcon,
    password = false,
    prefix,
    error,
    helperText,
    showCharacterCount = false,
    maxLength,
    value,
    multiline,
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
  const { colors, styles, focusStyle } = useThemedStyles(createStyles);
  const [hidden, setHidden] = useState(password);
  const [focused, setFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const iconColor = error ? colors.danger : focused ? colors.primary : colors.placeholder;

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.field,
          multiline && styles.multilineField,
          focused && [styles.fieldFocused, focusStyle],
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
          accessibilityHint={[error || helperText, accessibilityHint].filter(Boolean).join('. ') || undefined}
          accessibilityState={{ ...accessibilityState, disabled: !editable }}
          aria-disabled={!editable}
          aria-invalid={!!error}
          placeholderTextColor={colors.placeholder}
          placeholder={placeholder}
          secureTextEntry={hidden}
          editable={editable}
          value={value}
          maxLength={maxLength}
          multiline={multiline}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, multiline && styles.multilineInput, !editable && styles.disabledText, style]}
          {...rest}
        />
        {password && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar contraseña' : 'Ocultar contraseña'}
            accessibilityState={{ disabled: !editable }}
            disabled={!editable}
            onPress={() => setHidden((v) => !v)}
            onFocus={() => setPasswordFocused(true)} onBlur={() => setPasswordFocused(false)}
            style={[styles.passwordButton, passwordFocused && focusStyle]}>
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={iconColor}
            />
          </TouchableOpacity>
        )}
      </View>
      {(error || helperText || (showCharacterCount && maxLength != null)) && (
        <View style={styles.supportRow}>
          <View style={styles.helper} accessibilityLiveRegion={error ? 'polite' : undefined}>
            {!!error && <Ionicons accessible={false} name="alert-circle" size={16} color={colors.danger} />}
            {!!(error || helperText) && <Text style={[styles.helperText, !!error && styles.error]}>{error || helperText}</Text>}
          </View>
          {showCharacterCount && maxLength != null && <Text style={styles.counter}
            accessibilityLabel={`${value?.length ?? 0} de ${maxLength} caracteres`}>
            {value?.length ?? 0}/{maxLength}
          </Text>}
        </View>
      )}
    </View>
  );
});

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrapper: { gap: spacing.sm },
  label: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.semibold },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    paddingHorizontal: spacing.sm + spacing.xs,
    minHeight: controls.minHeight,
  },
  fieldFocused: { borderColor: colors.primary, backgroundColor: colors.surface },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { backgroundColor: colors.disabledBackground },
  disabledText: { color: colors.disabledText },
  multilineField: { alignItems: 'flex-start' },
  multilineInput: { minHeight: 96, textAlignVertical: 'top' },
  lead: { marginRight: spacing.sm },
  prefix: { marginRight: spacing.sm, fontSize: fontSize.md, color: colors.text, fontWeight: '500' },
  input: { flex: 1, minWidth: 0, minHeight: controls.minHeight - 2, paddingVertical: spacing.sm, fontSize: fontSize.md, color: colors.text },
  passwordButton: {
    width: controls.minHeight,
    minHeight: controls.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.sm },
  helper: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  helperText: { flexShrink: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  error: { color: colors.danger },
  counter: { fontSize: fontSize.xs, color: colors.textSecondary, marginLeft: 'auto' },
});
