import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { controles, fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'dangerSoft' | 'text';

type Props = PressableProps & {
  title: string;
  loading?: boolean;
  loadingLabel?: string;
  variant?: Variant;
  /** Name of an Ionicons icon shown before the title. */
  leadingIcon?: IoniconsIconName;
  /** Name of an Ionicons icon shown to the right of the title. */
  trailingIcon?: IoniconsIconName;
};

export function Button({
  title,
  loading = false,
  loadingLabel,
  variant = 'primary',
  leadingIcon,
  trailingIcon,
  disabled,
  accessibilityLabel,
  accessibilityState,
  hitSlop,
  style,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const { colors, styles, estiloFoco } = useEstilos(crearEstilos);
  const isDisabled = disabled || loading;
  const [enfocado, setEnfocado] = useState(false);
  const textoVisible = loading ? (loadingLabel ?? `${title}…`) : title;
  const colorTexto = isDisabled && !loading
    ? colors.textoDeshabilitado
    : variant === 'primary' || variant === 'danger'
      ? colors.textOnPrimary
      : variant === 'dangerSoft' ? colors.danger : variant === 'text' ? colors.textSecondary : colors.primary;

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={loading ? textoVisible : (accessibilityLabel ?? title)}
      accessibilityState={{ ...accessibilityState, disabled: !!isDisabled, busy: loading || accessibilityState?.busy }}
      aria-disabled={!!isDisabled}
      aria-busy={loading || accessibilityState?.busy}
      disabled={isDisabled}
      hitSlop={hitSlop}
      onFocus={(event) => { setEnfocado(true); onFocus?.(event); }}
      onBlur={(event) => { setEnfocado(false); onBlur?.(event); }}
      style={(state) => [
        styles.base,
        styles[variant],
        state.pressed && !isDisabled && [styles.pressed,
          variant === 'primary' && styles.primaryPressed,
          variant === 'secondary' && styles.secondaryPressed],
        typeof style === 'function' ? style(state) : style,
        isDisabled && !loading && styles.disabled,
        variant === 'text' && styles.text,
        enfocado && estiloFoco,
      ]}>
      <View style={styles.content} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {loading ? (
          <ActivityIndicator
            size="small"
            color={colorTexto}
          />
        ) : leadingIcon ? (
          <Ionicons
            name={leadingIcon}
            size={20}
            color={colorTexto}
          />
        ) : null}
        <Text style={[styles.label, variant === 'text' && styles.textLabel, { color: colorTexto }]}>
          {textoVisible}
        </Text>
        {!loading && trailingIcon ? (
          <Ionicons
            name={trailingIcon}
            size={20}
            color={colorTexto}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const crearEstilos = ({ colors, modo }: Tema) => StyleSheet.create({
  base: {
    minHeight: controles.altoMinimo,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOpacity: modo === 'light' ? 0.16 : 0,
    shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: modo === 'light' ? 2 : 0 },
  primaryPressed: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  secondaryPressed: { backgroundColor: colors.primarioSuave, borderColor: colors.primary },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.bordeControl,
  },
  danger: { backgroundColor: colors.danger },
  dangerSoft: { backgroundColor: colors.peligroSuave, borderColor: colors.danger },
  text: { backgroundColor: 'transparent', borderColor: 'transparent' },
  textLabel: { textDecorationLine: 'underline' },
  pressed: { transform: [{ translateY: 1 }], shadowOpacity: 0, elevation: 0 },
  disabled: { backgroundColor: colors.fondoDeshabilitado, borderColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  content: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, textAlign: 'center' },
});
