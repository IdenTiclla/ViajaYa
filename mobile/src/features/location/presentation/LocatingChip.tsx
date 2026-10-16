/**
 * Passive status over the real map while the position is on its way. It is the replacement
 * for a generic failure message: it explains the wait, has no retry, and the search goes on.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { fixChipText, type FixChipPhase } from '../domain/gateCopy';

type Props = {
  phase: FixChipPhase;
  /** Replaces the default copy (e.g. outside the service area). */
  message?: string;
  /** Alternative path inside the chip, e.g. «Elegir en el mapa». It is not a retry. */
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

const PHASE_ICON: Record<Exclude<FixChipPhase, 'locating'>, IoniconsIconName> = {
  weak: 'cellular-outline',
  estimated: 'time-outline',
};

export function LocatingChip({ phase, message, actionLabel, onAction, style }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const text = message ?? fixChipText(phase);
  return (
    <View style={[styles.chip, style]} accessibilityLiveRegion="polite" accessible={!onAction}
      accessibilityLabel={onAction ? undefined : text}>
      {phase === 'locating' && !message ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons
          name={message ? 'information-circle-outline' : PHASE_ICON[phase as Exclude<FixChipPhase, 'locating'>]}
          size={20}
          color={colors.primary}
        />
      )}
      <Text style={styles.text}>{text}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={styles.action}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  chip: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  text: { flex: 1, color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  action: { minHeight: 36, justifyContent: 'center' },
  actionText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
