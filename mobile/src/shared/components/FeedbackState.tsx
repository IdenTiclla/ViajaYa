import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button } from '@/shared/components/Button';

type Props = {
  title: string;
  message?: string;
  icon?: IoniconsIconName;
  loading?: boolean;
  compact?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

/** Estado consistente para cargas, errores y listas vacías. */
export function FeedbackState({
  title,
  message,
  icon = 'information-circle-outline',
  loading = false,
  compact = false,
  actionLabel,
  onAction,
}: Props) {
  const { colors, styles } = useEstilos(crearEstilos);
  return (
    <View
      style={[styles.root, compact ? styles.compact : styles.expanded]}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: loading }}
      accessibilityRole={loading ? 'progressbar' : undefined}>
      <View style={styles.iconWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
          <Ionicons name={icon} size={30} color={colors.primary} />
      )}
      </View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button
          title={actionLabel}
          variant="secondary"
          leadingIcon="refresh"
          disabled={loading}
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  root: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  expanded: { flex: 1 },
  compact: { minHeight: 180, flexShrink: 0 },
  iconWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.primarioSuave,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  message: {
    maxWidth: 360,
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  action: { minWidth: 160, marginTop: spacing.sm },
});
