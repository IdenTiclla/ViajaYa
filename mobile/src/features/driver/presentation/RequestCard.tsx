/**
 * Incoming request card (driver), shared by the list and the map.
 *
 * Passenger, rating, trips and payment; price with Bs/km; distance to the
 * pickup and the A → B route; actions ✕ · Contraofertar · Aceptar Bs X. A sent,
 * expired or rejected offer, a paused request or one taken by another driver
 * shows a status band on top and collapses the route to one line. The `map`
 * variant is compact (street km/min of the selected request, pager inside);
 * the `list` variant can also be **rejected by swiping**.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeIn } from 'react-native-reanimated';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBrandFontStyle } from '@/core/theme/brandFont';
import { useCountdown } from '@/core/hooks/useCountdown';
import { useNow } from '@/core/hooks/useNow';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import type { Coordinates } from '@/features/booking/domain/types';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import { formatBolivianos } from '@/features/rides/domain/money';
import { serviceNouns } from '@/features/rides/domain/serviceNouns';
import type { OpenRide } from '@/features/rides/domain/types';
import { PersonAvatar } from '@/shared/components';

const PAYMENT_LABELS = { qr: 'QR', cash: 'Efectivo' } as const;
const OFFER_TTL_S = 30;
const NEW_REQUEST_MS = 20_000;

export type RequestRouteSummary = { distanceMeters: number; durationSeconds: number };

type Props = {
  ride: OpenRide;
  variant?: 'list' | 'map';
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
  /** Expiry (ISO) of the sent offer; drives the band's countdown. */
  offerExpiresAt: string | null;
  /** Price the driver offered (shown when `offered`). */
  offerPrice: number | null;
  onPress?: () => void;
  onViewOffer: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onCounterOffer: () => void;
  /** Withdraw the sent offer (offered state only). */
  onWithdraw: () => void;
  /** The driver's current GPS fix, to show how far the pickup is. */
  driverCoordinates?: Coordinates | null;
  /** Street route of the trip, when known (the map's selected request). */
  route?: RequestRouteSummary | null;
  /** Map carousel position, shown inside the card. */
  pager?: { index: number; total: number; onPrevious: () => void; onNext: () => void };
};

export function RequestCard({
  ride,
  variant = 'list',
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
  onCounterOffer,
  onWithdraw,
  driverCoordinates = null,
  route = null,
  pager,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  const isNew = useIsNew(ride.createdAt);
  const swipeRef = useRef<SwipeableMethods>(null);
  const map = variant === 'map';
  const { rider } = ride;
  const first = firstName(rider.fullName);
  const nouns = serviceNouns(ride.service);
  const tripKm = useMemo(() => route ? route.distanceMeters / 1000
    : haversineKm(ride.origin.coordinates, ride.destination.coordinates), [route, ride.origin, ride.destination]);
  const pickupKm = useMemo(
    () => driverCoordinates ? haversineKm(driverCoordinates, ride.origin.coordinates) : null,
    [driverCoordinates, ride.origin],
  );
  // With a sent offer the card shows the driver's amount, not the passenger's fare.
  const displayPrice = offered && offerPrice != null ? offerPrice : ride.fare;
  const perKm = pricePerKm(displayPrice, tripKm);
  const canOffer = !offered && !paused && !taken;
  const retry = expired || rejected;
  const banded = offered || expired || rejected || paused || taken;
  const highlighted = isNew && !banded;
  const specialService = ride.service === 'delivery' || ride.service === 'moving';
  const tripText = route
    ? `${formatKm(tripKm)} · ${Math.max(1, Math.round(route.durationSeconds / 60))} min`
    : formatKm(tripKm);

  const meta = taken ? 'Desaparece en unos segundos' : [
    rider.rating != null ? `★ ${rider.rating.toFixed(1)}` : null,
    rider.rating == null && rider.tripsCompleted === 0
      ? `${nouns.customerTitle} nuevo`
      : `${rider.tripsCompleted} ${rider.tripsCompleted === 1 ? 'viaje' : 'viajes'}`,
    PAYMENT_LABELS[ride.payment],
  ].filter(Boolean).join(' · ');
  const acceptVerb = retry ? 'Ofertar' : ride.autoAccept ? 'Tomar' : 'Aceptar';
  const showTopRow = highlighted || specialService || pager != null;

  const card = (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Solicitud de ${rider.fullName}, ${SERVICE_META[ride.service].label}, ${ride.autoAccept ? 'aceptación inmediata, ' : ''}${offered && offerPrice != null ? `tu oferta Bs ${formatBolivianos(offerPrice)}` : `Bs ${formatBolivianos(ride.fare)}`}`}
      style={[styles.card, map && styles.cardMap, highlighted && styles.cardNew]}>
      {offered && <OfferedBand expiresAt={offerExpiresAt} riderName={first} />}
      {expired && <StatusBand icon="time-outline" tone="accent" text="Tu oferta venció sin respuesta" />}
      {rejected && <StatusBand icon="close" tone="danger" text={`${first} rechazó tu oferta`} />}
      {paused && <StatusBand icon="create-outline" tone="muted" text={`${first} está cambiando su solicitud`} />}
      {taken && (
        <StatusBand icon="car-sport-outline" tone="brand"
          text={`Otro conductor tomó ${nouns.request === 'viaje' ? 'este viaje' : `esta ${nouns.request}`}`} />
      )}

      <View style={[styles.body, map && styles.bodyMap]}>
        {showTopRow && (
          <View style={styles.topRow}>
            {highlighted && (
              <View style={styles.newBadge}><Text style={styles.newBadgeText}>Nueva</Text></View>
            )}
            {specialService && (
              <View style={styles.serviceChip}>
                <Ionicons name={SERVICE_META[ride.service].icon} size={13} color={colors.primary} />
                <Text style={styles.serviceChipText}>{SERVICE_META[ride.service].shortLabel}</Text>
              </View>
            )}
            {!banded && <TimeAgo createdAt={ride.createdAt} />}
            {pager && (
              <View style={styles.pager} accessibilityLiveRegion="polite">
                <PagerButton icon="chevron-back" label="Solicitud anterior"
                  disabled={pager.index <= 0} onPress={pager.onPrevious} />
                <Text style={styles.pagerText}>{pager.index + 1} de {pager.total}</Text>
                <PagerButton icon="chevron-forward" label="Solicitud siguiente"
                  disabled={pager.index >= pager.total - 1} onPress={pager.onNext} />
              </View>
            )}
          </View>
        )}

        <View style={[styles.personRow, (paused || taken) && styles.dimmed]}>
          <PersonAvatar name={rider.fullName} size={44} />
          <View style={styles.personInfo}>
            <Text style={styles.riderName} numberOfLines={1}>{rider.fullName}</Text>
            <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
          </View>
          <View style={styles.priceCol}>
            <Text style={[styles.fare, brandFont]}>Bs {formatBolivianos(displayPrice)}</Text>
            {offered && offerPrice != null ? (
              <Text style={styles.perKm}>Tu oferta · pidió Bs {formatBolivianos(ride.fare)}</Text>
            ) : perKm && !taken ? (
              <Text style={styles.perKm}>Bs {perKm}/km</Text>
            ) : null}
          </View>
        </View>

        {ride.autoAccept && canOffer && (
          <View style={styles.autoAccept}>
            <Ionicons name="flash" size={15} color={colors.warning} />
            <Text style={styles.autoAcceptText}>Acepta su precio y el viaje es tuyo</Text>
          </View>
        )}

        {paused ? (
          <Text style={styles.routeLine}>Podrás ofertar cuando vuelva a publicarla.</Text>
        ) : taken ? null : banded ? (
          <Text style={styles.routeLine} numberOfLines={2}>
            {ride.origin.name} → {ride.destination.name} · {tripText}
          </Text>
        ) : (
          <View style={[styles.route, map && styles.routeMap]}>
            {pickupKm != null && (
              <View style={styles.pickupRow}>
                <Ionicons name="navigate" size={15} color={colors.primary} />
                <Text style={styles.pickupText}>Recoger a {formatKm(pickupKm)} de ti</Text>
              </View>
            )}
            <RouteStop letter="A" name={ride.origin.name}
              detail={!map && !!ride.origin.address && ride.origin.address !== ride.origin.name ? ride.origin.address : null} />
            <RouteStop letter="B" name={ride.destination.name}
              inline={map ? tripText : null}
              detail={map ? null : route ? `Viaje de ${tripText} por calle` : `Viaje de ${tripText} en línea recta`} />
          </View>
        )}

        {offered && (
          <View style={styles.actionsTwo}>
            <CardButton kind="secondary" danger label="Retirar" accessibilityLabel="Retirar oferta"
              disabled={disabled} onPress={onWithdraw} />
            <CardButton kind="primary" label="Ver mi oferta" grow
              accessibilityLabel={`Ver oferta para ${rider.fullName}`} onPress={onViewOffer} />
          </View>
        )}
        {paused && (
          <CardButton kind="secondary" label="Quitar de la lista" disabled={disabled} onPress={onDismiss} />
        )}
        {canOffer && (
          <View style={styles.actionsThree}>
            <TouchableOpacity
              style={[styles.iconButton, disabled && styles.disabled]}
              onPress={onDismiss}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${retry ? 'Quitar' : 'Rechazar'} solicitud de ${rider.fullName}`}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
            <CardButton kind="secondary" label="Contraofertar" disabled={disabled} onPress={onCounterOffer} />
            <CardButton
              kind="primary"
              grow
              label={pendingAccept ? 'Enviando…' : `${acceptVerb} Bs ${formatBolivianos(ride.fare)}`}
              accessibilityLabel={`${acceptVerb} por Bs ${formatBolivianos(ride.fare)}`}
              loading={pendingAccept}
              disabled={disabled}
              onPress={onAccept}
            />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  if (map) return card;
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={!disabled && canOffer}
      friction={2}
      leftThreshold={40}
      renderLeftActions={() => (
        <View style={styles.swipeAction}>
          <Ionicons name="close-circle-outline" size={26} color={colors.textOnPrimary} />
          <Text style={styles.swipeActionText}>{retry ? 'Quitar' : 'Rechazar'}</Text>
        </View>
      )}
      onSwipeableWillOpen={() => onDismiss()}>
      {card}
    </ReanimatedSwipeable>
  );
}

function RouteStop({ letter, name, detail, inline }: {
  letter: 'A' | 'B'; name: string; detail?: string | null; inline?: string | null;
}) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.routeStop}>
      <View style={[styles.dot, letter === 'B' && styles.dotB]}>
        <Text style={[styles.dotText, letter === 'B' && styles.dotTextB]}>{letter}</Text>
      </View>
      <View style={styles.routeStopText}>
        <Text style={styles.routeText} numberOfLines={1}>
          {name}{inline ? <Text style={styles.routeInline}> · {inline}</Text> : null}
        </Text>
        {!!detail && <Text style={styles.routeAddress} numberOfLines={1}>{detail}</Text>}
      </View>
    </View>
  );
}

function CardButton({ kind, label, accessibilityLabel, onPress, disabled = false, loading = false, grow = false, danger = false }: {
  kind: 'primary' | 'secondary';
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  grow?: boolean;
  danger?: boolean;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const primary = kind === 'primary';
  return (
    <TouchableOpacity
      style={[styles.button, primary ? styles.buttonPrimary : styles.buttonSecondary, grow && styles.buttonGrow,
        (disabled || loading) && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}>
      {loading && <ActivityIndicator color={colors.textOnPrimary} size="small" />}
      <Text style={[styles.buttonText, primary ? styles.buttonTextPrimary : danger && styles.buttonTextDanger]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function PagerButton({ icon, label, disabled, onPress }: {
  icon: IoniconsIconName; label: string; disabled: boolean; onPress: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={[styles.pagerButton, disabled && styles.pagerButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}>
      <Ionicons name={icon} size={20} color={disabled ? colors.placeholder : colors.primary} />
    </TouchableOpacity>
  );
}

type BandTone = 'success' | 'accent' | 'danger' | 'muted' | 'brand';

function StatusBand({ icon, tone, text, trailing, children }: {
  icon: IoniconsIconName; tone: BandTone; text: string; trailing?: string; children?: ReactNode;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const background = {
    success: colors.success, accent: colors.accent, danger: colors.danger,
    muted: colors.surfaceMuted, brand: colors.brand,
  }[tone];
  // `brand` is the same blue in both themes, so it keeps its white text.
  const foreground = tone === 'accent' ? colors.textOnAccent
    : tone === 'muted' ? colors.text : tone === 'brand' ? colors.textOnBrand : colors.textOnPrimary;
  return (
    <Animated.View entering={FadeIn.duration(180)} style={{ backgroundColor: background }}
      accessibilityLiveRegion="polite">
      <View style={styles.band}>
        <Ionicons name={icon} size={16} color={foreground} />
        <Text style={[styles.bandText, { color: foreground }]} numberOfLines={2}>{text}</Text>
        {!!trailing && <Text style={[styles.bandTrailing, { color: foreground }]}>{trailing}</Text>}
      </View>
      {children}
    </Animated.View>
  );
}

/**
 * "Oferta enviada" band with the 30 s countdown. `useCountdown` lives here so
 * the per-second tick re-renders only the band, not the whole card.
 */
function OfferedBand({ expiresAt, riderName }: { expiresAt: string | null; riderName: string }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const secondsLeft = useCountdown(expiresAt);
  const expiring = secondsLeft != null && secondsLeft <= 0;
  const progress = secondsLeft == null ? 1 : Math.max(0, Math.min(1, secondsLeft / OFFER_TTL_S));
  return (
    <StatusBand icon="checkmark" tone="success"
      text={expiring ? 'Expirando…' : `Oferta enviada · esperando a ${riderName}`}
      trailing={!expiring && secondsLeft != null ? `${secondsLeft} s` : undefined}>
      <View style={styles.bandTrack}>
        <View style={[styles.bandTrackFill, { backgroundColor: colors.textOnPrimary }]} />
        <View style={[styles.bandProgress, { width: `${progress * 100}%`, backgroundColor: colors.textOnPrimary }]} />
      </View>
    </StatusBand>
  );
}

/** "hace 8 s" / "hace 3 min", refreshed on its own so the card does not re-render. */
function TimeAgo({ createdAt }: { createdAt: string | null }) {
  const { styles } = useThemedStyles(createStyles);
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  const now = useNow(5_000);
  if (!Number.isFinite(created)) return null;
  const seconds = Math.max(0, Math.floor((now - created) / 1000));
  const label = seconds < 60 ? `hace ${seconds} s`
    : seconds < 3600 ? `hace ${Math.floor(seconds / 60)} min`
      : `hace ${Math.floor(seconds / 3600)} h`;
  return <Text style={styles.timeAgo}>{label}</Text>;
}

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

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardMap: {
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  cardNew: { borderWidth: 2, borderColor: colors.accent },
  body: { padding: spacing.md - 2, gap: spacing.sm + 4 },
  bodyMap: { paddingTop: spacing.sm + 2 },

  band: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm,
  },
  bandText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  bandTrailing: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  bandTrack: { height: 4 },
  bandTrackFill: { ...StyleSheet.absoluteFill, opacity: 0.28 },
  bandProgress: { height: 4 },

  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  newBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accent },
  newBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textOnAccent },
  serviceChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm + 2, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  serviceChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary },
  timeAgo: { fontSize: fontSize.xs, color: colors.textSecondary },
  pager: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pagerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  pagerButtonDisabled: { backgroundColor: colors.surfaceMuted },
  pagerText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },

  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  dimmed: { opacity: 0.6 },
  personInfo: { flex: 1, minWidth: 0, gap: 2 },
  riderName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.textSecondary },
  priceCol: { alignItems: 'flex-end', maxWidth: '45%' },
  fare: { fontSize: 26, fontWeight: fontWeight.bold, color: colors.text },
  perKm: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'right' },

  autoAccept: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  autoAcceptText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.warning },

  routeLine: { fontSize: fontSize.sm, color: colors.textSecondary },
  route: { gap: spacing.sm, padding: spacing.sm + 4, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  routeMap: { padding: 0, gap: spacing.xs + 2, backgroundColor: 'transparent' },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  pickupText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  routeStop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  routeStopText: { flex: 1, minWidth: 0 },
  dot: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  dotB: { backgroundColor: colors.text },
  dotText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.textOnBrand },
  dotTextB: { color: colors.background },
  routeText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },
  routeInline: { fontWeight: fontWeight.regular, color: colors.textSecondary },
  routeAddress: { fontSize: fontSize.xs, color: colors.textSecondary },

  actionsTwo: { flexDirection: 'row', gap: spacing.sm },
  actionsThree: { flexDirection: 'row', gap: spacing.sm },
  iconButton: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  button: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
  },
  buttonGrow: { flex: 1.35 },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.controlBorder },
  buttonText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center' },
  buttonTextPrimary: { fontWeight: fontWeight.bold, color: colors.textOnPrimary },
  buttonTextDanger: { color: colors.danger },
  disabled: { opacity: 0.5 },

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
});
