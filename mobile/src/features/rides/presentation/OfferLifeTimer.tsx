/**
 * Contador de vida de una solicitud/oferta: muestra mm:ss restantes de la
 * ventana de negociación. Se pone en rojo en los últimos segundos. No corre su
 * propio reloj (recibe los segundos ya calculados) para compartir un solo tick.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

const LOW_THRESHOLD = 10;

export function OfferLifeTimer({
  secondsLeft,
  label = 'Vence en',
}: {
  secondsLeft: number | null;
  label?: string;
}) {
  if (secondsLeft == null) return null;
  const low = secondsLeft <= LOW_THRESHOLD;
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <View
      style={[styles.chip, low && styles.chipLow]}
      accessibilityRole="timer"
      accessibilityLabel={`${label} ${secondsLeft} segundos`}>
      <Ionicons name="time-outline" size={14} color={low ? colors.danger : colors.primary} />
      <Text style={[styles.text, low && styles.textLow]}>
        {label} {mm}:{ss}
      </Text>
    </View>
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
