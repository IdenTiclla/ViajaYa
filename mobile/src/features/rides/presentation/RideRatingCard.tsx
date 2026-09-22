import { TripProgress } from '@/features/rides/presentation/TripProgress';
/**
 * Tarjeta de cierre de viaje reutilizable (pasajero ↔ conductor).
 *
 * Muestra el resumen del viaje terminado y permite calificar a la otra parte
 * (1–5 estrellas + comentario opcional). La opción de omitir permanece disponible
 * hasta enviar, incluso después de elegir estrellas.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useRateRide, useSkipRating } from '@/features/rides/application/useCloseFlow';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { Ride } from '@/features/rides/domain/types';
import { Button, PersonAvatar, TextField } from '@/shared/components';
import { TripSecondaryAction } from './TripSecondaryAction';

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

const VALORACIONES = ['Mala', 'Regular', 'Buena', 'Muy buena', 'Excelente'];

export function RideRatingCard({
  ride,
  counterpartName,
  counterpartVehicle,
  rateeRole,
  onDone,
}: Props) {
  const { colors, styles, estiloFoco } = useEstilos(crearEstilos);
  const { fontScale } = useWindowDimensions();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [estrellaEnfocada, setEstrellaEnfocada] = useState<number | null>(null);
  const rate = useRateRide();
  const skip = useSkipRating();
  const submissionLock = useRef(false);

  const price = formatBolivianos(ride.acceptedPrice ?? ride.fare);
  const rateeLabel = rateeRole === 'driver' ? 'tu conductor' : 'tu pasajero';
  const submitting = rate.isPending || skip.isPending;

  const submitRating = () => {
    if (submitting || submissionLock.current || score < 1) return;
    submissionLock.current = true;
    skip.reset();
    void rate
      .mutateAsync({
        rideId: ride.id,
        input: { score, comment: comment.trim() || null },
      })
      .then(onDone)
      .catch(() => undefined)
      .finally(() => { submissionLock.current = false; });
  };

  const skipRating = () => {
    if (submitting || submissionLock.current) return;
    submissionLock.current = true;
    rate.reset();
    void skip.mutateAsync(ride.id).then(onDone).catch(() => undefined)
      .finally(() => { submissionLock.current = false; });
  };

  return (
    <View style={styles.root}>
      <TripProgress status="completed" />
      <View style={styles.successHeader}>
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={28} color={colors.textOnPrimary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {ride.service === 'delivery' ? '¡Entrega completada!' : rateeRole === 'passenger' ? 'Viaje completado' : '¡Llegaste a tu destino!'}
        </Text>
        <Text style={styles.subtitle}>Gracias por usar ViajaYa.</Text>
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Precio acordado</Text>
          <Text style={styles.summaryValue}>Bs {price}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Pago acordado</Text>
          <Text style={styles.summaryValue}>{ride.payment === 'qr' ? 'QR' : 'Efectivo'}</Text>
        </View>
      </View>

      {!!counterpartName && (
        <View style={styles.counterpart}>
          {fontScale <= 1.3 && (
            <PersonAvatar name={counterpartName} />
          )}
          <View style={styles.counterpartInfo}>
            <Text style={styles.counterpartName}>{counterpartName}</Text>
            {!!counterpartVehicle && <Text style={styles.vehicle}>{counterpartVehicle}</Text>}
          </View>
        </View>
      )}

      <View style={styles.rateBlock}>
        <Text style={styles.rateTitle}>Califica a {rateeLabel}</Text>
        <Text style={styles.subtitle}>Elige las estrellas. El comentario es opcional.</Text>
        <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={`Calificación de ${rateeLabel}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              disabled={submitting}
              onPress={() => setScore(n)}
              onFocus={() => setEstrellaEnfocada(n)}
              onBlur={() => setEstrellaEnfocada(null)}
              style={({ pressed }) => [
                styles.starButton,
                score === n && styles.starSelected,
                pressed && styles.starPressed,
                estrellaEnfocada === n && estiloFoco,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: score === n, disabled: submitting }}
              aria-checked={score === n}
              accessibilityLabel={`${n} ${n === 1 ? 'estrella' : 'estrellas'}: ${VALORACIONES[n - 1]}`}>
              <Ionicons
                accessible={false}
                name={n <= score ? 'star' : 'star-outline'}
                size={34}
                color={n <= score ? colors.primary : colors.textSecondary}
              />
            </Pressable>
          ))}
        </View>
        <Text style={styles.scoreLabel} accessibilityLiveRegion="polite">
          {score > 0 ? `${VALORACIONES[score - 1]} · ${score} de 5 estrellas` : 'Selecciona de 1 a 5 estrellas'}
        </Text>
      </View>

      <Button title={showComment ? 'Ocultar comentario' : comment ? 'Editar comentario' : 'Agregar comentario (opcional)'}
        variant="secondary" leadingIcon="chatbubble-outline" disabled={score === 0 || submitting}
        accessibilityState={{ expanded: showComment }} onPress={() => setShowComment(value => !value)} />
      {showComment && <TextField label="Comentario (opcional)" showCharacterCount
          style={{ minHeight: 96 * fontScale }}
          placeholder={
            score > 0
              ? '¿Qué te gustaría destacar o mejorar?'
              : 'Selecciona una calificación para comentar'
          }
          value={comment}
          onChangeText={setComment}
          editable={score > 0 && !submitting}
          maxLength={500}
          multiline
          accessibilityLabel="Comentario de la calificación"
          accessibilityHint="Opcional, hasta 500 caracteres. Selecciona primero una calificación."
        />}

      {(rate.isError || skip.isError) && (
        <Text style={styles.error} accessibilityRole="alert">{getApiErrorMessage(rate.error ?? skip.error)}</Text>
      )}

        <Button
          title="Enviar calificación"
          loadingLabel="Enviando calificación"
          loading={rate.isPending}
          disabled={submitting || score === 0}
          leadingIcon="send"
          onPress={submitRating}
        />
      <TripSecondaryAction
        title={skip.isPending ? 'Cerrando…' : 'Omitir calificación'}
        disabled={submitting}
        onPress={skipRating}
      />
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
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
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  summaryItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs },
  summaryDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  summaryLabel: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  summaryValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },

  counterpart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  counterpartInfo: { flex: 1, minWidth: 0, gap: 2 },
  counterpartName: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },

  rateBlock: { alignItems: 'center', gap: spacing.xs },
  rateTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center' },
  stars: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xs },
  starButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  starPressed: { backgroundColor: colors.surfaceMuted },
  starSelected: { backgroundColor: colors.primarioSuave },
  scoreLabel: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },

  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
