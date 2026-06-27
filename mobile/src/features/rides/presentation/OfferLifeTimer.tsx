/**
 * Contador de vida de una solicitud/oferta: muestra mm:ss restantes de la
 * ventana de negociación. Se pone en rojo en los últimos segundos y late (pulso)
 * para llamar la atención. No corre su propio reloj (recibe los segundos ya
 * calculados) para compartir un solo tick.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

const LOW_THRESHOLD = 10;

export function OfferLifeTimer({
  secondsLeft,
  label = 'Vence en',
}: {
  secondsLeft: number | null;
  label?: string;
}) {
  const low = secondsLeft != null && secondsLeft <= LOW_THRESHOLD;
  const reduceMotion = useReducedMotion();
  // Pulso solo en los últimos segundos (y si el usuario no pidió reducir motion).
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

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  chipLow: { backgroundColor: '#FDECEA' },
  text: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  textLow: { color: colors.danger },
});
