import { StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, spacing, useEstilos, type Tema } from '@/core/theme';
import type { RideStatus } from '../domain/types';

const STAGES = ['Negociación', 'Recogida', 'Viaje', 'Calificación'] as const;

/** A compact stage indicator shared by both participants, including large text. */
export function TripProgress({ status }: { status: RideStatus }) {
  const { styles } = useEstilos(createStyles);
  if (status === 'cancelled') return null;
  const index = status === 'searching' ? 0 : status === 'in_progress' ? 2 : status === 'completed' ? 3 : 1;
  const label = `Paso ${index + 1} de 4 · ${STAGES[index]}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.root}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {STAGES.map((stage, i) => <View key={stage} style={[styles.segment, i <= index && styles.done]} />)}
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  root: { gap: spacing.sm, paddingVertical: spacing.xs },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  track: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  done: { backgroundColor: colors.primary },
});
