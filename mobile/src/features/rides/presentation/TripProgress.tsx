import { Ionicons } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { RideStatus } from '../domain/types';

const STAGES = ['Oferta', 'Recogida', 'Viaje', 'Pago'] as const;
const STAGE_NAMES = ['Oferta', 'Recogida', 'Viaje', 'Pago y calificación'] as const;

export function tripStageIndex(status: RideStatus): number {
  if (status === 'searching') return 0;
  if (status === 'in_progress') return 2;
  if (status === 'completed') return 3;
  return 1;
}

/**
 * The four ride stages shared by passenger and driver. The driver sees stage 1
 * while composing and waiting on an offer, so both roles walk the same path.
 * `onBrand` renders it over the brand-blue confirmation screens.
 */
export function TripProgress({ status, onBrand = false }: { status: RideStatus; onBrand?: boolean }) {
  const { colors, styles } = useThemedStyles(createStyles);
  if (status === 'cancelled') return null;
  const index = tripStageIndex(status);
  const label = `Paso ${index + 1} de 4: ${STAGE_NAMES[index]}`;
  const doneBar = onBrand ? colors.textOnBrand : colors.primary;
  const activeBar = onBrand ? colors.accent : colors.primary;
  const pendingBar = onBrand ? 'rgba(255,255,255,0.28)' : colors.border;
  return (
    <View accessible accessibilityLabel={label} style={styles.root}>
      {STAGES.map((stage, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <View key={stage} style={styles.stage}>
            <View style={[styles.bar, { backgroundColor: done ? doneBar : active ? activeBar : pendingBar }]} />
            <View style={styles.labelRow}>
              {done && (
                <Ionicons name="checkmark" size={12}
                  color={onBrand ? colors.textOnBrand : colors.success} />
              )}
              <Text numberOfLines={1} style={[
                styles.label,
                onBrand && styles.labelOnBrand,
                done && (onBrand ? styles.doneOnBrand : styles.done),
                active && (onBrand ? styles.activeOnBrand : styles.active),
              ]}>
                {done ? stage : `${i + 1} ${stage}`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flexDirection: 'row', gap: 6, paddingVertical: spacing.xs },
  stage: { flex: 1, minWidth: 0, gap: 6 },
  bar: { height: 4, borderRadius: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  label: { flexShrink: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  labelOnBrand: { color: 'rgba(255,255,255,0.75)' },
  done: { color: colors.text },
  doneOnBrand: { color: colors.textOnBrand },
  active: { color: colors.primary, fontWeight: fontWeight.bold },
  activeOnBrand: { color: colors.accent, fontWeight: fontWeight.bold },
});
