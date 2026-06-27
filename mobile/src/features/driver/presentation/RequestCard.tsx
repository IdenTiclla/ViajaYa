/**
 * Tarjeta de una solicitud entrante (conductor) — diseño Material-You.
 *
 * Avatar + rating del pasajero, precio ofertado y **contraoferta rápida** (pills
 * +Bs que envían una contraoferta al instante) o precio propio (botón lápiz →
 * `KeypadModal`). Ruta Pickup/Drop-off y acciones Decline / Aceptar. Al pulsar
 * Aceptar el botón pasa a "Esperando…" (spinner) mientras se envía. Estado
 * `offered` → banner "Oferta enviada"; `rejected` → reofertar. Se puede
 * **rechazar deslizando** (panel rojo).
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { SlideInDown } from 'react-native-reanimated';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useCountdown } from '@/core/hooks/useCountdown';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import type { OpenRide } from '@/features/rides/domain/types';

const PAYMENT_LABELS = { qr: 'QR', cash: 'Efectivo' } as const;
const QUICK_DELTAS = [1, 2, 5] as const;

type Props = {
  ride: OpenRide;
  offered: boolean;
  rejected: boolean;
  /** La oferta del conductor venció (30 s) sin respuesta. */
  expired: boolean;
  /** El pasajero está modificando la solicitud (no se puede ofertar aún). */
  paused: boolean;
  /** Otro conductor se llevó el viaje (la card desaparecerá pronto por WS). */
  taken: boolean;
  /** Bloquea toda interacción (hay una mutación en curso). */
  disabled: boolean;
  /** Esta tarjeta es la que está enviando la oferta/aceptación (botón "Esperando…"). */
  pendingAccept: boolean;
  /** Expiración (ISO) de la oferta enviada; alimenta el contador del banner offered. */
  offerExpiresAt: string | null;
  onPress: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onQuickAdd: (delta: number) => void;
  onOpenKeypad: () => void;
  /** Retira la oferta enviada (solo estado offered). */
  onWithdraw: () => void;
};

export function RequestCard({
  ride,
  offered,
  rejected,
  expired,
  paused,
  taken,
  disabled,
  pendingAccept,
  offerExpiresAt,
  onPress,
  onAccept,
  onDismiss,
  onQuickAdd,
  onOpenKeypad,
  onWithdraw,
}: Props) {
  const swipeRef = useRef<SwipeableMethods>(null);
  const tripKm = useMemo(
    () => haversineKm(ride.origin.coordinates, ride.destination.coordinates),
    [ride.origin, ride.destination],
  );
  const perKm = pricePerKm(ride.fare, tripKm);

  const { rider } = ride;
  const initial = rider.fullName.trim().charAt(0).toUpperCase() || '?';
  const meta = [
    ride.service === 'taxi' ? 'Taxi' : 'Moto',
    `${rider.tripsCompleted} ${rider.tripsCompleted === 1 ? 'viaje' : 'viajes'}`,
    PAYMENT_LABELS[ride.payment],
  ].join(' · ');

  const renderLeftActions = () => (
    <View style={styles.swipeAction}>
      <Ionicons name="close-circle" size={26} color={colors.textOnPrimary} />
      <Text style={styles.swipeActionText}>Rechazar</Text>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={40}
      renderLeftActions={renderLeftActions}
      onSwipeableWillOpen={() => onDismiss()}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Solicitud de ${rider.fullName}, ${ride.service === 'taxi' ? 'taxi' : 'moto'}, Bs ${ride.fare.toFixed(2)}`}
        style={styles.card}>
        {offered && (
          <OfferedBanner expiresAt={offerExpiresAt} disabled={disabled} onWithdraw={onWithdraw} />
        )}
        {expired && (
          <View style={styles.expiredBanner}>
            <Ionicons name="time-outline" size={15} color="#5A4500" />
            <Text style={styles.expiredBannerText}>Tu oferta expiró · vuelve a ofertar</Text>
          </View>
        )}
        {paused && (
          <View style={styles.pausedBanner}>
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.pausedBannerText}>
              El pasajero está modificando su solicitud
            </Text>
            <TouchableOpacity
              style={styles.dismissBannerBtn}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Quitar solicitud del panel">
              <Text style={styles.dismissBannerBtnText}>Quitar</Text>
            </TouchableOpacity>
          </View>
        )}
        {taken && (
          <View style={styles.takenBanner}>
            <Ionicons name="trophy-outline" size={15} color={colors.textOnPrimary} />
            <Text style={styles.takenBannerText}>Otro conductor tomó el viaje</Text>
          </View>
        )}
        {rejected && (
          <View style={styles.rejectedBanner}>
            <Ionicons name="close-circle" size={15} color={colors.textOnPrimary} />
            <Text style={styles.rejectedBannerText}>
              El pasajero no aceptó tu oferta · vuelve a intentarlo
            </Text>
          </View>
        )}

        <View style={styles.cardTop}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            {rider.rating != null && (
              <View style={styles.ratingBadge}>
                <Text style={styles.ratingBadgeText}>{rider.rating.toFixed(1)}★</Text>
              </View>
            )}
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.riderName} numberOfLines={1}>
              {rider.fullName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          <View style={styles.priceCol}>
            <Text style={styles.fare}>Bs {ride.fare.toFixed(2)}</Text>
            {perKm && <Text style={styles.perKm}>Bs {perKm}/km</Text>}
          </View>
        </View>

        {/* Contraoferta rápida (rápida +Bs y lápiz): visible mientras se pueda
            ofertar (default, expired y rejected). En expired/rejected es la forma
            de mejorar la oferta tras un rechazo/vencimiento. */}
        {!offered && !paused && !taken && (
          <View style={styles.quick}>
            <Text style={styles.quickLabel}>CONTRAOFERTA RÁPIDA</Text>
            <View style={styles.quickRow}>
              {QUICK_DELTAS.map((delta) => (
                <TouchableOpacity
                  key={delta}
                  style={[styles.quickPill, disabled && styles.disabled]}
                  onPress={() => onQuickAdd(delta)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Contraofertar con Bs ${delta} más`}>
                  <Text style={styles.quickPillText}>+Bs {delta}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.pencilBtn, disabled && styles.disabled]}
                onPress={onOpenKeypad}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Contraoferta con precio personalizado">
                <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.route}>
          <View style={styles.routeDots}>
            <View style={styles.dotA} />
            <View style={styles.trackLine} />
            <View style={styles.dotB} />
          </View>
          <View style={styles.routeTexts}>
            <View>
              <Text style={styles.routeLabel}>RECOGIDA</Text>
              <Text style={styles.routeText} numberOfLines={1}>
                {ride.origin.name}
              </Text>
            </View>
            <View>
              <Text style={styles.routeLabel}>DESTINO</Text>
              <Text style={[styles.routeText, styles.routeDest]} numberOfLines={1}>
                {ride.destination.name} · {formatKm(tripKm)}
              </Text>
            </View>
          </View>
        </View>

        {offered || paused || taken ? null : expired || rejected ? (
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
              onPress={onAccept}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Ofertar de nuevo por Bs ${ride.fare.toFixed(2)}`}>
              {pendingAccept ? (
                <ActivityIndicator color={colors.textOnPrimary} size="small" />
              ) : (
                <Text style={styles.acceptText}>Ofertar de nuevo</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.decline, disabled && styles.disabled]}
              onPress={onDismiss}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Rechazar solicitud">
              <Text style={styles.declineText}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
              onPress={onAccept}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Aceptar por Bs ${ride.fare.toFixed(2)}`}>
              {pendingAccept ? (
                <View style={styles.acceptWaiting}>
                  <ActivityIndicator color={colors.textOnPrimary} size="small" />
                  <Text style={styles.acceptText}>Esperando…</Text>
                </View>
              ) : (
                <Text style={styles.acceptText}>Aceptar</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    </ReanimatedSwipeable>
  );
}

/**
 * Banner "Oferta enviada" con el **contador de los 30 s** (reutiliza `OfferLifeTimer`)
 * y un botón para **retirar** la oferta. El `useCountdown` vive aquí (no en
 * `RequestCard`) para que el tick por segundo re-renderice solo este banner, no
 * toda la tarjeta.
 */
function OfferedBanner({
  expiresAt,
  disabled,
  onWithdraw,
}: {
  expiresAt: string | null;
  disabled: boolean;
  onWithdraw: () => void;
}) {
  const secondsLeft = useCountdown(expiresAt);
  const expiring = secondsLeft != null && secondsLeft <= 0;
  return (
    <Animated.View entering={SlideInDown.duration(200)} style={styles.offeredBanner}>
      <Ionicons name="checkmark-circle" size={15} color={colors.textOnPrimary} />
      <Text style={styles.offeredBannerText}>{expiring ? 'Expirando…' : 'Oferta enviada'}</Text>
      {!expiring && secondsLeft != null && <OfferLifeTimer secondsLeft={secondsLeft} label="" />}
      <TouchableOpacity
        style={[styles.withdrawBtn, disabled && styles.disabled]}
        onPress={onWithdraw}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Retirar oferta">
        <Text style={styles.withdrawBtnText}>Retirar</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  swipeAction: {
    width: 96,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginRight: spacing.sm,
  },
  swipeActionText: { color: colors.textOnPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    overflow: 'hidden',
  },

  offeredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.success,
  },
  offeredBannerText: { color: colors.textOnPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  withdrawBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  withdrawBtnText: { color: colors.textOnPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.accent,
  },
  expiredBannerText: { color: '#5A4500', fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  pausedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  pausedBannerText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  dismissBannerBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dismissBannerBtnText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  takenBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
  },
  takenBannerText: { color: colors.textOnPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  rejectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.danger,
  },
  rejectedBannerText: { color: colors.textOnPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },

  cardTop: { flexDirection: 'row', gap: spacing.md },
  avatarWrap: { width: 48, height: 48 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  ratingBadge: {
    position: 'absolute',
    bottom: -3,
    right: -6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  ratingBadgeText: { color: '#5A4500', fontSize: 10, fontWeight: fontWeight.bold },

  cardInfo: { flex: 1, gap: 3, justifyContent: 'center' },
  riderName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary },

  priceCol: { alignItems: 'flex-end', justifyContent: 'center' },
  fare: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  perKm: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.semibold, marginTop: 2 },

  quick: { gap: spacing.xs },
  quickLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.bold, letterSpacing: 0.5 },
  quickRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  quickPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(245,197,24,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,24,0.5)',
  },
  quickPillText: { color: '#7A6000', fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  pencilBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  route: { flexDirection: 'row', gap: spacing.sm },
  routeDots: { alignItems: 'center', gap: 3, paddingTop: 3 },
  dotA: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primary },
  trackLine: { width: 2, height: 16, backgroundColor: colors.border },
  dotB: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.danger },
  routeTexts: { flex: 1, gap: spacing.sm },
  routeLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.bold, letterSpacing: 0.5, marginBottom: 1 },
  routeText: { fontSize: fontSize.sm, color: colors.text },
  routeDest: { fontWeight: fontWeight.semibold },

  cardActions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decline: { flex: 1, backgroundColor: colors.surfaceMuted },
  declineText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  accept: { flex: 1.6, backgroundColor: colors.primary },
  acceptText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  acceptWaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  disabled: { opacity: 0.5 },
});
