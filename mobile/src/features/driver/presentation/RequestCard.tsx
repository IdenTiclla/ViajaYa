/**
 * Incoming request card (driver) — Material You design.
 *
 * Passenger avatar + rating, offered price and **quick counter-offer** (+Bs
 * pills that send a counter-offer instantly) or a custom price (pencil button →
 * native `TextInput`). Pickup/Drop-off route and Rechazar / Enviar oferta actions. When
 * tapped, the button switches to "Enviando…" (spinner) while the proposal is created. Status
 * `offered` → "Oferta enviada" banner; `rejected` → re-offer. It can be
 * **rejected by swiping** so it is not seen again until the passenger modifies it.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { SlideInDown } from 'react-native-reanimated';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useCountdown } from '@/core/hooks/useCountdown';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import { formatBolivianos } from '@/features/rides/domain/money';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import type { OpenRide } from '@/features/rides/domain/types';
import { serviceNouns } from '@/features/rides/domain/serviceNouns';
import { PersonAvatar } from '@/shared/components';

const PAYMENT_LABELS = { qr: 'QR', cash: 'Efectivo' } as const;
const QUICK_DELTAS = [1, 2, 5] as const;

type Props = {
  ride: OpenRide;
  offered: boolean;
  rejected: boolean;
  /** The driver's offer expired (30 s) without an answer. */
  expired: boolean;
  /** The passenger is modifying the request (offering is not possible yet). */
  paused: boolean;
  /** Another driver got the ride (the card will disappear soon via WS). */
  taken: boolean;
  /** Block all interaction (a mutation is in progress). */
  disabled: boolean;
  /** This card is the one sending the offer ("Enviando…" button). */
  pendingAccept: boolean;
  /** Expiry (ISO) of the sent offer; drives the countdown of the offered banner. */
  offerExpiresAt: string | null;
  /** Price the driver offered (shown when `offered`). */
  offerPrice: number | null;
  onPress: () => void;
  onViewOffer: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onQuickAdd: (delta: number) => void;
  onOpenPriceInput: () => void;
  /** Withdraw the sent offer (offered state only). */
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
  offerPrice,
  onPress,
  onViewOffer,
  onAccept,
  onDismiss,
  onQuickAdd,
  onOpenPriceInput,
  onWithdraw,
}: Props) {
  const { colors, styles } = useEstilos(crearEstilos);
  const swipeRef = useRef<SwipeableMethods>(null);
  const tripKm = useMemo(
    () => haversineKm(ride.origin.coordinates, ride.destination.coordinates),
    [ride.origin, ride.destination],
  );
  // With a sent offer we show the amount the driver proposed (not the passenger's
  // fare), so they see their counter-offer reflected on the card.
  const displayPrice = offered && offerPrice != null ? offerPrice : ride.fare;
  const perKm = pricePerKm(displayPrice, tripKm);

  const { rider } = ride;
  const { customer: customerNoun, request: requestNoun } = serviceNouns(ride.service);
  const meta = [
    SERVICE_META[ride.service].shortLabel,
    `${rider.tripsCompleted} ${rider.tripsCompleted === 1 ? 'viaje' : 'viajes'}`,
    PAYMENT_LABELS[ride.payment],
  ].join(' · ');

  const renderLeftActions = () => (
    <View style={styles.swipeAction}>
      <Ionicons name="close-circle-outline" size={26} color={colors.textOnPrimary} />
      <Text style={styles.swipeActionText}>Rechazar</Text>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={!disabled && !offered && !paused && !taken}
      friction={2}
      leftThreshold={40}
      renderLeftActions={renderLeftActions}
      onSwipeableWillOpen={() => onDismiss()}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Solicitud de ${rider.fullName}, ${SERVICE_META[ride.service].label}, ${offered && offerPrice != null ? `tu oferta Bs ${formatBolivianos(offerPrice)}` : `Bs ${formatBolivianos(ride.fare)}`}`}
        style={styles.card}>
        {offered && (
          <OfferedBanner expiresAt={offerExpiresAt} />
        )}
        {expired && (
          <View style={styles.expiredBanner}>
            <Ionicons name="time-outline" size={15} color={colors.textoSobreAcento} />
            <Text style={styles.expiredBannerText}>Tu oferta expiró · vuelve a ofertar</Text>
          </View>
        )}
        {paused && (
          <View style={styles.pausedBanner}>
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.pausedBannerText}>
              El {customerNoun} está modificando su solicitud
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
            <Text style={styles.takenBannerText}>Otro conductor tomó la {requestNoun}</Text>
          </View>
        )}
        {rejected && (
          <View style={styles.rejectedBanner}>
            <Ionicons name="close-circle" size={15} color={colors.textOnPrimary} />
            <Text style={styles.rejectedBannerText}>
              El {customerNoun} no aceptó tu oferta · vuelve a intentarlo
            </Text>
          </View>
        )}

        <View style={styles.cardTop}>
          <View style={styles.avatarWrap}>
            <PersonAvatar name={rider.fullName} size={48} />
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
            <Text style={styles.fare}>Bs {formatBolivianos(displayPrice)}</Text>
            {offered && offerPrice != null ? (
              <Text style={styles.perKm}>Tu oferta</Text>
            ) : perKm ? (
              <Text style={styles.perKm}>Bs {perKm}/km</Text>
            ) : null}
          </View>
        </View>

        {/*
 * Quick counter-offer (quick +Bs and pencil): visible while offering is possible
 * (default, expired and rejected). In expired/rejected it is the way
 * to improve the offer after a rejection/expiry.
 */}
        <View style={styles.quickSlot}>
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
                  onPress={onOpenPriceInput}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Contraoferta con precio personalizado">
                  <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.route}>
          <View style={styles.routeStop}>
            <Text style={styles.routeLabel}>ORIGEN</Text>
            <Text style={styles.routeText} numberOfLines={1}>
              {ride.origin.name}
            </Text>
          </View>
          <View style={styles.routeStop}>
            <Text style={styles.routeLabel}>DESTINO</Text>
            <Text style={[styles.routeText, styles.routeDestination]} numberOfLines={1}>
              {ride.destination.name} · {formatKm(tripKm)}
            </Text>
          </View>
        </View>

        <View style={styles.actionsSlot}>
          {offered && (
            <View style={styles.cardActions}>
              <TouchableOpacity style={[styles.actionBtn, styles.accept]} onPress={onViewOffer}
                accessibilityRole="button" accessibilityLabel={`Ver oferta para ${rider.fullName}`}>
                <Text style={styles.acceptText}>Ver oferta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.decline,
                  styles.withdrawAction,
                  disabled && styles.disabled,
                ]}
                onPress={onWithdraw}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Retirar oferta">
                <Ionicons name="close-circle-outline" size={19} color={colors.danger} />
                <Text style={styles.declineText}>Retirar oferta</Text>
              </TouchableOpacity>
            </View>
          )}
          {!offered &&
            !paused &&
            !taken &&
            (expired || rejected ? (
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
                  onPress={onAccept}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Ofertar de nuevo por Bs ${formatBolivianos(ride.fare)}`}>
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
                  accessibilityLabel={`Enviar oferta por Bs ${formatBolivianos(ride.fare)}`}>
                  {pendingAccept ? (
                    <View style={styles.acceptWaiting}>
                      <ActivityIndicator color={colors.textOnPrimary} size="small" />
                      <Text style={styles.acceptText}>Enviando…</Text>
                    </View>
                  ) : (
                    <Text style={styles.acceptText}>Enviar oferta</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
        </View>
      </TouchableOpacity>
    </ReanimatedSwipeable>
  );
}

/**
 * "Oferta enviada" banner with the **30 s countdown** (reuses `OfferLifeTimer`).
 * `useCountdown` lives here (not in `RequestCard`) so the per-second tick
 * re-renders only this banner, not the whole card.
 */
function OfferedBanner({
  expiresAt,
}: {
  expiresAt: string | null;
}) {
  const { colors, styles } = useEstilos(crearEstilos);
  const secondsLeft = useCountdown(expiresAt);
  const expiring = secondsLeft != null && secondsLeft <= 0;
  return (
    <Animated.View entering={SlideInDown.duration(200)} style={styles.offeredBanner}>
      <Ionicons name="checkmark-circle" size={15} color={colors.textOnPrimary} />
      <Text style={styles.offeredBannerText}>{expiring ? 'Expirando…' : 'Oferta enviada'}</Text>
      {!expiring && secondsLeft != null && <OfferLifeTimer secondsLeft={secondsLeft} label="" />}
    </Animated.View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  swipeAction: {
    width: 96,
    backgroundColor: colors.textSecondary,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    overflow: 'hidden',
  },

  offeredBanner: {
    minHeight: 42,
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
  expiredBanner: {
    minHeight: 42,
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
  expiredBannerText: { color: colors.textoSobreAcento, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  pausedBanner: {
    minHeight: 42,
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
    minHeight: 42,
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
    minHeight: 42,
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
  ratingBadgeText: { color: colors.textoSobreAcento, fontSize: 10, fontWeight: fontWeight.bold },

  cardInfo: { flex: 1, gap: 3, justifyContent: 'center' },
  riderName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary },

  priceCol: { alignItems: 'flex-end', justifyContent: 'center' },
  fare: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  perKm: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.semibold, marginTop: 2 },

  // Keep the height when hiding controls in terminal or pending states.
  quickSlot: { minHeight: 50 },
  quick: { gap: spacing.xs },
  quickLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.bold, letterSpacing: 0.5 },
  quickRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  quickPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.avisoSuave,
    borderWidth: 1,
    borderColor: 'rgba(245,197,24,0.5)',
  },
  quickPillText: { color: colors.aviso, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  pencilBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  route: { flexDirection: 'row', gap: spacing.md },
  routeStop: { flex: 1, minWidth: 0 },
  routeLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  routeText: { fontSize: fontSize.sm, color: colors.text },
  routeDestination: { fontWeight: fontWeight.semibold },

  actionsSlot: { minHeight: 48 },
  cardActions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  withdrawAction: { flexDirection: 'row', gap: spacing.xs },
  decline: { flex: 1, backgroundColor: colors.peligroSuave, borderWidth: 1, borderColor: colors.bordePeligro },
  declineText: { color: colors.danger, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  accept: { flex: 1.6, backgroundColor: colors.primary },
  acceptText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  acceptWaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  disabled: { opacity: 0.5 },
});
