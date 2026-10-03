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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { SlideInDown } from 'react-native-reanimated';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useCountdown } from '@/core/hooks/useCountdown';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import { formatBolivianos } from '@/features/rides/domain/money';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import type { OpenRide } from '@/features/rides/domain/types';
import type { Coordinates } from '@/features/booking/domain/types';
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
  /** The driver's current GPS fix, to show how far the pickup is. */
  driverCoordinates?: Coordinates | null;
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
  driverCoordinates = null,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const isNew = useIsNew(ride.createdAt);
  const swipeRef = useRef<SwipeableMethods>(null);
  const tripKm = useMemo(
    () => haversineKm(ride.origin.coordinates, ride.destination.coordinates),
    [ride.origin, ride.destination],
  );
  // With a sent offer we show the amount the driver proposed (not the passenger's
  // fare), so they see their counter-offer reflected on the card.
  const pickupKm = useMemo(
    () => driverCoordinates ? haversineKm(driverCoordinates, ride.origin.coordinates) : null,
    [driverCoordinates, ride.origin],
  );
  const displayPrice = offered && offerPrice != null ? offerPrice : ride.fare;
  const perKm = pricePerKm(displayPrice, tripKm);

  const { rider } = ride;
  const { customer: customerNoun, request: requestNoun } = serviceNouns(ride.service);
  const meta = [
    rider.rating != null ? `★ ${rider.rating.toFixed(1)}` : 'Nuevo',
    `${rider.tripsCompleted} ${rider.tripsCompleted === 1 ? 'viaje' : 'viajes'}`,
  ].join(' · ');
  const canOffer = !offered && !paused && !taken;

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
        accessibilityLabel={`Solicitud de ${rider.fullName}, ${SERVICE_META[ride.service].label}, ${ride.autoAccept ? 'aceptación inmediata, ' : ''}${offered && offerPrice != null ? `tu oferta Bs ${formatBolivianos(offerPrice)}` : `Bs ${formatBolivianos(ride.fare)}`}`}
        style={[styles.card, isNew && !offered && !expired && !paused && !taken && styles.cardNew]}>
        {isNew && !offered && !expired && !paused && !taken && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>Nueva</Text>
          </View>
        )}
        {offered && (
          <OfferedBanner expiresAt={offerExpiresAt} />
        )}
        {expired && (
          <View style={styles.expiredBanner}>
            <Ionicons name="time-outline" size={15} color={colors.textOnAccent} />
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

        <View style={styles.tagsRow}>
          <View style={styles.serviceTag}>
            <Ionicons name={SERVICE_META[ride.service].icon} size={13} color={colors.primary} />
            <Text style={styles.serviceTagText}>{SERVICE_META[ride.service].shortLabel}</Text>
          </View>
          <View style={styles.paymentTag}>
            <Ionicons name={ride.payment === 'qr' ? 'qr-code-outline' : 'cash-outline'} size={13} color={colors.success} />
            <Text style={styles.paymentTagText}>{PAYMENT_LABELS[ride.payment]}</Text>
          </View>
          {ride.autoAccept && (
            // The passenger turned on automatic acceptance: taking the fare wins the ride.
            <View style={styles.autoAccept}>
              <Ionicons name="flash" size={12} color={colors.warning} />
              <Text style={styles.autoAcceptText}>Acepta su precio y es tuyo</Text>
            </View>
          )}
        </View>

        <View style={styles.cardTop}>
          <PersonAvatar name={rider.fullName} size={44} />
          <View style={styles.cardInfo}>
            <Text style={styles.riderName} numberOfLines={1}>{rider.fullName}</Text>
            <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
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

        <View style={styles.route}>
          {pickupKm != null && (
            <View style={styles.pickupRow}>
              <Ionicons name="navigate" size={15} color={colors.primary} />
              <Text style={styles.pickupText}>Recoger a {formatKm(pickupKm)} de ti</Text>
            </View>
          )}
          <View style={styles.routeStop}>
            <View style={styles.dotA}><Text style={styles.dotText}>A</Text></View>
            <View style={styles.routeStopText}>
              <Text style={styles.routeText} numberOfLines={1}>{ride.origin.name}</Text>
              {!!ride.origin.address && ride.origin.address !== ride.origin.name && (
                <Text style={styles.routeAddress} numberOfLines={1}>{ride.origin.address}</Text>
              )}
            </View>
          </View>
          <View style={styles.routeStop}>
            <View style={styles.dotB}><Text style={[styles.dotText, styles.dotTextB]}>B</Text></View>
            <View style={styles.routeStopText}>
              <Text style={styles.routeText} numberOfLines={1}>{ride.destination.name}</Text>
              <Text style={styles.routeAddress} numberOfLines={1}>Viaje de {formatKm(tripKm)} en línea recta</Text>
            </View>
          </View>
        </View>

        {canOffer && (
          <View style={styles.quickRow}>
            {QUICK_DELTAS.map((delta) => (
              <TouchableOpacity
                key={delta}
                style={[styles.quickPill, disabled && styles.disabled]}
                onPress={() => onQuickAdd(delta)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Contraofertar Bs ${formatBolivianos(ride.fare + delta)}`}>
                <Text style={styles.quickPillText}>Bs {formatBolivianos(ride.fare + delta)}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.quickPill, disabled && styles.disabled]}
              onPress={onOpenPriceInput}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Contraoferta con otro monto">
              <Ionicons name="create-outline" size={16} color={colors.text} />
              <Text style={styles.quickPillText}>Otro</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.actionsSlot}>
          {offered && (
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.decline, disabled && styles.disabled]}
                onPress={onWithdraw}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Retirar oferta">
                <Text style={styles.withdrawText}>Retirar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.accept]} onPress={onViewOffer}
                accessibilityRole="button" accessibilityLabel={`Ver oferta para ${rider.fullName}`}>
                <Text style={styles.acceptText}>Ver mi oferta</Text>
              </TouchableOpacity>
            </View>
          )}
          {canOffer && (
            <View style={styles.cardActions}>
              {!(expired || rejected) && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.decline, disabled && styles.disabled]}
                  onPress={onDismiss}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Rechazar solicitud">
                  <Text style={styles.declineText}>Rechazar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
                onPress={onAccept}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`${expired || rejected ? 'Ofertar de nuevo' : 'Aceptar'} por Bs ${formatBolivianos(ride.fare)}`}>
                {pendingAccept ? (
                  <View style={styles.acceptWaiting}>
                    <ActivityIndicator color={colors.textOnPrimary} size="small" />
                    <Text style={styles.acceptText}>Enviando…</Text>
                  </View>
                ) : (
                  <Text style={styles.acceptText}>
                    {expired || rejected ? 'Ofertar de nuevo' : 'Aceptar'} Bs {formatBolivianos(ride.fare)}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
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
  const { colors, styles } = useThemedStyles(createStyles);
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

const NEW_REQUEST_MS = 20_000;

/** True while a request is fresh enough to be highlighted as just arrived. */
function useIsNew(createdAt: string | null) {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  const [isNew, setIsNew] = useState(() => !Number.isNaN(created) && created + NEW_REQUEST_MS > Date.now());
  useEffect(() => {
    if (!isNew) return;
    const remaining = Math.min(NEW_REQUEST_MS, Math.max(0, created + NEW_REQUEST_MS - Date.now()));
    const timer = setTimeout(() => setIsNew(false), remaining);
    return () => clearTimeout(timer);
  }, [created, isNew]);
  return isNew;
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  cardNew: { borderWidth: 2, borderColor: colors.accent },
  newBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  newBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textOnAccent },
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
    borderRadius: 18,
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
  expiredBannerText: { color: colors.textOnAccent, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
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

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  serviceTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  serviceTagText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary },
  paymentTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.successSoft },
  paymentTagText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.success },
  autoAccept: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.warningSoft },
  autoAcceptText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.warning },

  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  cardInfo: { flex: 1, minWidth: 0, gap: 2 },
  riderName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.textSecondary },
  priceCol: { alignItems: 'flex-end' },
  fare: { fontSize: 26, fontWeight: fontWeight.bold, color: colors.text },
  perKm: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },

  route: { gap: spacing.sm, padding: spacing.sm + 4, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  pickupText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  routeStop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeStopText: { flex: 1, minWidth: 0 },
  dotA: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  dotB: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.textOnBrand },
  dotTextB: { color: colors.background },
  routeText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  routeAddress: { fontSize: fontSize.xs, color: colors.textSecondary },

  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  quickPill: {
    flexGrow: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  quickPillText: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  actionsSlot: {},
  cardActions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  decline: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.controlBorder },
  declineText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  withdrawText: { color: colors.danger, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  accept: { flex: 1.6, backgroundColor: colors.primary },
  acceptText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold, textAlign: 'center' },
  acceptWaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  disabled: { opacity: 0.5 },
});
