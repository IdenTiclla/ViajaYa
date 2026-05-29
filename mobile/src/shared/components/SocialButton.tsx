import { FontAwesome } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

type Provider = 'google' | 'facebook';

type Props = PressableProps & {
  provider: Provider;
  loading?: boolean;
};

const CONFIG: Record<
  Provider,
  { label: string; icon: keyof typeof FontAwesome.glyphMap; tint: string }
> = {
  google: { label: 'Google', icon: 'google', tint: colors.text },
  facebook: { label: 'Facebook', icon: 'facebook', tint: colors.facebook },
};

/** Botón de proveedor social. Conectar a los hooks de OAuth en la Fase 6. */
export function SocialButton({ provider, loading = false, disabled, style, ...rest }: Props) {
  const cfg = CONFIG[provider];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Continuar con ${cfg.label}`}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        (state.pressed || isDisabled) && styles.dimmed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <View style={styles.content}>
          <FontAwesome name={cfg.icon} size={18} color={cfg.tint} />
          <Text style={styles.label}>{cfg.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
});
