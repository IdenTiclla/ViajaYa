import { FontAwesome } from '@expo/vector-icons';
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

type Provider = 'google' | 'facebook';

type Props = PressableProps & {
  provider: Provider;
  loading?: boolean;
};

/** Acceso social con la misma escala táctil que el resto de acciones. */
export function SocialButton({ provider, loading = false, disabled, style, onFocus, onBlur, accessibilityLabel, accessibilityState, ...rest }: Props) {
  const { colors, styles, estiloFoco } = useEstilos(crearEstilos);
  const [enfocado, setEnfocado] = useState(false);
  const CONFIG: Record<
    Provider,
    { label: string; icon: keyof typeof FontAwesome.glyphMap; tint: string }
  > = {
    google: { label: 'Google', icon: 'google', tint: colors.text },
    facebook: { label: 'Facebook', icon: 'facebook', tint: colors.facebook },
  };
  const cfg = CONFIG[provider];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={loading ? `Conectando con ${cfg.label}` : accessibilityLabel ?? `Continuar con ${cfg.label}`}
      accessibilityState={{ ...accessibilityState, disabled: !!isDisabled, busy: loading }}
      aria-disabled={!!isDisabled}
      aria-busy={loading}
      disabled={isDisabled}
      onFocus={(event) => { setEnfocado(true); onFocus?.(event); }}
      onBlur={(event) => { setEnfocado(false); onBlur?.(event); }}
      style={(state) => [
        styles.base,
        state.pressed && !isDisabled && styles.dimmed,
        typeof style === 'function' ? style(state) : style,
        isDisabled && !loading && styles.disabled,
        enfocado && estiloFoco,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <FontAwesome accessible={false} name={cfg.icon} size={18} color={isDisabled ? colors.textoDeshabilitado : cfg.tint} />
        )}
        <Text style={styles.label}>{loading ? 'Conectando…' : cfg.label}</Text>
      </View>
    </Pressable>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  base: {
    minHeight: controles.altoMinimo,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bordeControl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.92 },
  disabled: { backgroundColor: colors.fondoDeshabilitado, borderColor: 'transparent' },
  content: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { flexShrink: 1, textAlign: 'center', fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },
});
