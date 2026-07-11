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
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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

  const submitRating = () => {
    if (submitting || score < 1) return;
    skip.reset();
    void rate
      .mutateAsync({
        rideId: ride.id,
        input: { score, comment: comment.trim() || null },
      })
      .then(onDone)
      .catch(() => undefined);
  };

  const skipRating = () => {
    if (submitting) return;
    rate.reset();
    void skip.mutateAsync(ride.id).then(onDone).catch(() => undefined);
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
        <View style={styles.stars} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => setScore(n)}
              style={({ pressed }) => [styles.starButton, pressed && styles.starPressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: score === n }}
              accessibilityLabel={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}>
              <Ionicons
                name={n <= score ? 'star' : 'star-outline'}
                size={34}
                color={n <= score ? colors.accent : colors.border}
              />
            </Pressable>
          ))}
        </View>
        <Text style={styles.scoreLabel} accessibilityLiveRegion="polite">
          {score > 0 ? `${score} de 5 estrellas` : 'Selecciona de 1 a 5 estrellas'}
        </Text>
      </View>

      <TextInput
        style={[styles.comment, score === 0 && styles.commentDisabled]}
        placeholder={
          score > 0
            ? 'Añade un comentario (opcional)'
            : 'Selecciona una calificación para comentar'
        }
        placeholderTextColor={colors.textSecondary}
        value={comment}
        onChangeText={setComment}
        editable={score > 0 && !submitting}
        maxLength={500}
        multiline
        accessibilityLabel="Comentario de la calificación"
      />

      {(rate.isError || skip.isError) && (
        <Text style={styles.error}>{getApiErrorMessage(rate.error ?? skip.error)}</Text>
      )}

      {score > 0 ? (
        <Button
          title="Enviar calificación"
          loadingLabel="Enviando calificación"
          loading={submitting}
          leadingIcon="send"
          onPress={submitRating}
        />
      ) : (
        <Button
          title="Ahora no"
          loadingLabel="Cerrando"
          loading={submitting}
          variant="secondary"
          onPress={skipRating}
        />
      )}
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
  starButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  starPressed: { backgroundColor: colors.surfaceMuted },
  scoreLabel: { color: colors.textSecondary, fontSize: fontSize.xs },

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
  commentDisabled: { backgroundColor: colors.surfaceMuted, opacity: 0.72 },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
