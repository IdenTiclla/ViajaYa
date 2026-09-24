/**
 * Lifetime countdown of a request/offer: shows the mm:ss left in the
 * negotiation window. It turns red in the last seconds and beats (pulse)
 * to draw attention. It does not run its own clock (it receives the already
 * computed seconds) so a single tick is shared.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

const LOW_THRESHOLD = 10;

export function OfferLifeTimer({
  secondsLeft,
  label = 'Vence en',
}: {
  secondsLeft: number | null;
  label?: string;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const low = secondsLeft != null && secondsLeft <= LOW_THRESHOLD;
  const reduceMotion = useReducedMotion();
  // Pulse only in the last seconds (and if the user did not ask to reduce motion).
  const pulseStyle = useAnimatedStyle(() => {
    if (!low || reduceMotion) return {};
    return {
      transform: [
        {
          scale: withRepeat(
            withSequence(
              withTiming(1.06, { duration: 500 }),
              withTiming(1, { duration: 500 }),
            ),
            -1,
          ),
        },
      ],
    };
  }, [low, reduceMotion]);

  if (secondsLeft == null) return null;
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <Animated.View
      style={[styles.chip, low && styles.chipLow, pulseStyle]}
      accessibilityRole="timer"
      accessibilityLabel={`${label} ${secondsLeft} segundos`}>
      <Ionicons name="time-outline" size={14} color={low ? colors.danger : colors.primary} />
      <Text style={[styles.text, low && styles.textLow]}>
        {label} {mm}:{ss}
      </Text>
    </Animated.View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  chipLow: { backgroundColor: colors.dangerSoft },
  text: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  textLow: { color: colors.danger },
});
