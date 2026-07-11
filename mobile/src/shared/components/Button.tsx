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
  loadingLabel?: string;
  variant?: Variant;
  /** Nombre de un ícono de Ionicons mostrado antes del título. */
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  /** Nombre de un ícono de Ionicons mostrado a la derecha del título. */
  trailingIcon?: keyof typeof Ionicons.glyphMap;
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
  hitSlop,
  style,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={hitSlop ?? 4}
      style={(state) => [
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        state.pressed && styles.pressed,
        isDisabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={isPrimary ? colors.textOnPrimary : colors.primary}
          />
        ) : leadingIcon ? (
          <Ionicons
            name={leadingIcon}
            size={20}
            color={isPrimary ? colors.textOnPrimary : colors.primary}
          />
        ) : null}
        <Text
          style={[styles.label, isPrimary ? styles.labelPrimary : styles.labelSecondary]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.85}>
          {loading ? (loadingLabel ?? `${title}…`) : title}
        </Text>
        {!loading && trailingIcon ? (
          <Ionicons
            name={trailingIcon}
            size={20}
            color={isPrimary ? colors.textOnPrimary : colors.primary}
          />
        ) : null}
      </View>
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
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, textAlign: 'center' },
  labelPrimary: { color: colors.textOnPrimary },
  labelSecondary: { color: colors.primary },
});
