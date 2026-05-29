import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

type Variant = 'primary' | 'secondary';

type Props = PressableProps & {
  title: string;
  loading?: boolean;
  variant?: Variant;
  /** Nombre de un ícono de Ionicons mostrado a la derecha del título. */
  trailingIcon?: keyof typeof Ionicons.glyphMap;
};

export function Button({
  title,
  loading = false,
  variant = 'primary',
  trailingIcon,
  disabled,
  style,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        (state.pressed || isDisabled) && styles.dimmed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.textOnPrimary : colors.primary} />
      ) : (
        <View style={styles.content}>
          <Text style={[styles.label, isPrimary ? styles.labelPrimary : styles.labelSecondary]}>
            {title}
          </Text>
          {trailingIcon && (
            <Ionicons
              name={trailingIcon}
              size={20}
              color={isPrimary ? colors.textOnPrimary : colors.primary}
            />
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.primary },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dimmed: { opacity: 0.6 },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  labelPrimary: { color: colors.textOnPrimary },
  labelSecondary: { color: colors.primary },
});
