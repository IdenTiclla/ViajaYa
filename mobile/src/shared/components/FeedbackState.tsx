import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, spacing } from '@/core/theme';
import { Button } from '@/shared/components/Button';

type Props = {
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
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
  return (
    <View
      style={[styles.root, compact && styles.compact]}
      accessibilityLiveRegion="polite"
      accessibilityRole={loading ? 'progressbar' : undefined}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={30} color={colors.primary} />
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button
          title={actionLabel}
          variant="secondary"
          leadingIcon="refresh"
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  compact: { minHeight: 180, flex: 0 },
  iconWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: `${colors.primary}12`,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
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
