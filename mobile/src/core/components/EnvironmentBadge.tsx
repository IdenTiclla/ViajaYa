import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { env } from '@/core/config/env';
import { useEstilos as useThemedStyles, type Tema as Theme } from '@/core/theme';
import { fontSize, radius, spacing } from '@/core/theme/tokens';

/** Keep lower environments identifiable without intercepting trip controls. */
export function EnvironmentBadge() {
  const insets = useSafeAreaInsets();
  const { styles } = useThemedStyles(createStyles);
  if (env.appEnv === 'production') return null;
  const label = env.appEnv === 'development' ? 'Desarrollo' : 'Pruebas';

  return (
    <View pointerEvents="none" style={[styles.badge, { top: insets.top + spacing.xs }]}>
      <Text accessibilityLabel={`Entorno de ${label.toLowerCase()}`} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  badge: {
    position: 'absolute',
    right: spacing.sm,
    zIndex: 1000,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: { color: colors.text, fontSize: fontSize.xs },
});
