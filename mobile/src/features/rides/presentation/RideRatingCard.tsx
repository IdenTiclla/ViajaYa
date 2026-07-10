/**
 * Tarjeta de cierre de viaje reutilizable (pasajero ↔ conductor).
 *
 * Muestra el resumen del viaje terminado y permite calificar a la otra parte
 * (1–5 estrellas + comentario). El botón "Finalizar" envía la calificación si se
 * eligieron estrellas; si no, registra que el usuario decidió omitirla. Sigue el
 * diseño Stitch "Viaje Finalizado".
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useRateRide, useSkipRating } from '@/features/rides/application/useCloseFlow';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { Ride } from '@/features/rides/domain/types';
import { Button } from '@/shared/components';

type Props = {
  ride: Ride;
  /** Nombre de la otra parte (conductor para el pasajero; pasajero para el conductor). */
  counterpartName?: string | null;
  /** Detalle del vehículo, cuando se califica al conductor. */
  counterpartVehicle?: string | null;
  /** A quién se califica, para el texto de ayuda. */
  rateeRole: 'driver' | 'passenger';
  /** Se llama tras enviar la calificación o al omitir. */
  onDone: () => void;
};

export function RideRatingCard({
  ride,
  counterpartName,
  counterpartVehicle,
  rateeRole,
  onDone,
}: Props) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const rate = useRateRide();
  const skip = useSkipRating();

  const price = formatBolivianos(ride.acceptedPrice ?? ride.fare);
  const rateeLabel = rateeRole === 'driver' ? 'tu conductor' : 'tu pasajero';
  const initial = (counterpartName?.trim().charAt(0) || '?').toUpperCase();
  const submitting = rate.isPending || skip.isPending;

  const finish = () => {
    if (submitting) return;
    if (score >= 1) {
      skip.reset();
      void rate
        .mutateAsync({
          rideId: ride.id,
          input: { score, comment: comment.trim() || null },
        })
        .then(onDone)
        .catch(() => undefined);
    } else {
      rate.reset();
      void skip.mutateAsync(ride.id).then(onDone).catch(() => undefined);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.successHeader}>
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={28} color={colors.textOnPrimary} />
        </View>
        <Text style={styles.title}>¡Has llegado a tu destino!</Text>
        <Text style={styles.subtitle}>Gracias por viajar con ViajaYa.</Text>
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Costo</Text>
          <Text style={styles.summaryValue}>Bs {price}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Pago</Text>
          <Text style={styles.summaryValue}>{ride.payment === 'qr' ? 'QR' : 'Efectivo'}</Text>
        </View>
      </View>

      {!!counterpartName && (
        <View style={styles.counterpart}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.counterpartInfo}>
            <Text style={styles.counterpartName}>{counterpartName}</Text>
            {!!counterpartVehicle && <Text style={styles.vehicle}>{counterpartVehicle}</Text>}
          </View>
        </View>
      )}

      <View style={styles.rateBlock}>
        <Text style={styles.rateTitle}>Califica a {rateeLabel}</Text>
        <Text style={styles.subtitle}>Tu opinión nos ayuda a mejorar.</Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Ionicons
              key={n}
              name={n <= score ? 'star' : 'star-outline'}
              size={36}
              color={n <= score ? colors.accent : colors.border}
              style={styles.star}
              onPress={() => setScore(n)}
            />
          ))}
        </View>
      </View>

      <TextInput
        style={styles.comment}
        placeholder="Añade un comentario (opcional)"
        placeholderTextColor={colors.textSecondary}
        value={comment}
        onChangeText={setComment}
        multiline
      />

      {(rate.isError || skip.isError) && (
        <Text style={styles.error}>{getApiErrorMessage(rate.error ?? skip.error)}</Text>
      )}

      <Button title="Finalizar" loading={submitting} onPress={finish} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  successHeader: { alignItems: 'center', gap: spacing.xs },
  checkCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 2 },
  summaryDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  summaryLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  summaryValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },

  counterpart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  counterpartInfo: { flex: 1, gap: 2 },
  counterpartName: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },

  rateBlock: { alignItems: 'center', gap: spacing.xs },
  rateTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  stars: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  star: { padding: 2 },

  comment: {
    minHeight: 80,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.md,
    textAlignVertical: 'top',
  },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
