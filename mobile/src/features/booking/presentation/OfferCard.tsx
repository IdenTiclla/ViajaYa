import { Ionicons } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBrandFontStyle } from '@/core/theme/brandFont';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { OfferTag } from '@/features/rides/domain/offerTags';
import type { Offer } from '@/features/rides/domain/types';
import { Button, PersonAvatar } from '@/shared/components';
import { PlateBadge } from '@/features/rides/presentation/TripParts';
import { vehicleLabel } from '@/features/auth/domain/vehicleCatalog';

type Props = {
  offer: Offer;
  tag: OfferTag | null;
  now: number;
  /** The passenger's current fare, to tell "Tu precio" from a counter-offer. */
  requestedFare?: number | null;
  acceptingId: string | null;
  decisionsLocked: boolean;
  onAccept: () => void;
  onReject: () => void;
};

const OFFER_TTL_SECONDS = 30;

function clock(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}
const LOW_SECONDS = 10;
const NEW_OFFER_MS = 10_000;

/** Identity, price, arrival and expiry at a glance, with one clear decision. */
export function OfferCard({
  offer, tag, now, requestedFare, acceptingId, decisionsLocked, onAccept, onReject,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  const { fontScale } = useWindowDimensions();
  const { driver } = offer;
  const seconds = offer.expiresAt == null
    ? null
    : Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000));
  const expired = seconds === 0;
  const low = seconds != null && seconds <= LOW_SECONDS;
  const accepting = acceptingId === offer.id;
  const locked = decisionsLocked || expired;
  const inColumn = fontScale > 1.3;
  const fresh = offer.createdAt != null && now - Date.parse(offer.createdAt) < NEW_OFFER_MS;
  const atFare = requestedFare != null && Math.abs(offer.price - requestedFare) < 0.005;
  const price = formatBolivianos(offer.price);
  const vehicle = [vehicleLabel(driver.vehicleType), driver.vehicleModel].filter(Boolean).join(' · ');
  const delta = requestedFare != null ? Math.round((offer.price - requestedFare) * 100) / 100 : null;
  const chip = atFare
    ? { text: 'Tu precio', style: styles.chipSuccess, textStyle: styles.chipSuccessText }
    : delta != null && delta < 0
      ? { text: `Bs ${formatBolivianos(-delta)} menos`, style: styles.chipSuccess, textStyle: styles.chipSuccessText }
      : delta != null && delta > 0
        ? { text: `+Bs ${formatBolivianos(delta)} sobre tu precio`, style: styles.chipNeutral, textStyle: styles.chipNeutralText }
        : null;
  const arrivalClock = offer.etaMin != null ? clock(now + offer.etaMin * 60_000) : null;

  return (
    <View style={[styles.card, fresh && styles.cardFresh]}
      accessibilityLabel={`${fresh ? 'Nueva oferta' : 'Oferta'} de ${driver.fullName}: Bs ${price}${offer.etaMin != null ? `, llega en ${offer.etaMin} minutos` : ''}${seconds != null ? `, vence en ${seconds} segundos` : ''}`}>
      {(fresh || tag) && (
        <View style={styles.badges}>
          {fresh && (
            <View style={[styles.chipBadge, styles.chipNew]}>
              <Text style={[styles.chipText, styles.chipNewText]}>Nueva</Text>
            </View>
          )}
          {tag && (
            <View style={[styles.chipBadge, tag.kind === 'cheapest' ? styles.chipSuccess : styles.chipPrimary]}>
              <Text style={[styles.chipText, tag.kind === 'cheapest' ? styles.chipSuccessText : styles.chipPrimaryText]}>
                {tag.subLabel}
              </Text>
            </View>
          )}
        </View>
      )}
      <View style={[styles.header, inColumn && styles.column]}>
        {!inColumn && <PersonAvatar name={driver.fullName} size={48} />}
        <View style={styles.identity}>
          <Text style={styles.name}>{driver.fullName}</Text>
          <View style={styles.ratingRow}>
            {driver.rating != null && <Ionicons accessible={false} name="star" size={13} color={colors.accent} />}
            <Text style={styles.vehicle}>
              {[driver.rating != null ? driver.rating.toFixed(1) : 'Conductor nuevo',
                driver.tripsCompleted != null ? `${driver.tripsCompleted} ${driver.tripsCompleted === 1 ? 'viaje' : 'viajes'}` : null]
                .filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <View style={[styles.priceBlock, inColumn && styles.priceBlockColumn]}>
          <Text style={[styles.price, brandFont]}>Bs {price}</Text>
          {chip && (
            <View style={[styles.chip, chip.style]}>
              <Text style={[styles.chipText, chip.textStyle]}>{chip.text}</Text>
            </View>
          )}
        </View>
      </View>

      {(vehicle || driver.plate) ? (
        <View style={styles.vehicleRow}>
          <Ionicons accessible={false} name={driver.vehicleType === 'moto' ? 'bicycle' : driver.vehicleType === 'truck' ? 'bus' : 'car-sport'}
            size={18} color={colors.textSecondary} />
          <Text style={styles.vehicleText} numberOfLines={1}>{vehicle || 'Vehículo'}</Text>
          {!!driver.plate && <PlateBadge plate={driver.plate} />}
        </View>
      ) : null}

      <View style={styles.meta}>
        <View style={styles.eta}>
          <Ionicons accessible={false} name="time-outline" size={16} color={colors.primary} />
          <Text style={styles.etaText}>
            {offer.etaMin == null ? 'Sin estimación de llegada' : `Llega en ${offer.etaMin} min`}
            {arrivalClock ? <Text style={styles.etaClock}> · {arrivalClock}</Text> : null}
          </Text>
        </View>
        {seconds != null && (
          <Text style={[styles.expiry, low && styles.expiryLow]}>
            {expired ? 'Vencida' : `Vence en ${seconds} s`}
          </Text>
        )}
      </View>
      {seconds != null && (
        <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.fill, low && styles.fillLow,
            { width: `${Math.min(100, (seconds / OFFER_TTL_SECONDS) * 100)}%` }]} />
        </View>
      )}

      <View style={[styles.actions, inColumn && styles.column]}>
        <Button
          title="Rechazar"
          variant="secondary"
          onPress={onReject}
          disabled={locked}
          accessibilityLabel={`Rechazar oferta de ${driver.fullName}`}
          style={!inColumn && styles.reject}
        />
        <Button
          title={expired ? 'Oferta vencida' : `Aceptar Bs ${price}`}
          onPress={onAccept}
          disabled={locked}
          loading={accepting}
          loadingLabel="Aceptando…"
          accessibilityLabel={`Aceptar oferta de ${driver.fullName} por Bs ${price}`}
          style={!inColumn && styles.accept}
        />
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: { padding: spacing.md - 2, gap: spacing.sm + 4, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  cardFresh: { borderWidth: 2, borderColor: colors.accent },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill },
  chipNew: { backgroundColor: colors.accent },
  chipNewText: { color: colors.textOnAccent },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: fontSize.md + 1, color: colors.text, fontWeight: fontWeight.bold },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  vehicleText: { flex: 1, minWidth: 0, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  etaClock: { fontWeight: fontWeight.regular, color: colors.textSecondary },
  priceBlock: { alignItems: 'flex-end', gap: spacing.xs },
  priceBlockColumn: { alignItems: 'flex-start' },
  price: { fontSize: 30, fontWeight: fontWeight.bold, color: colors.text },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  chipText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  chipSuccess: { backgroundColor: colors.successSoft },
  chipSuccessText: { color: colors.success },
  chipPrimary: { backgroundColor: colors.primarySoft },
  chipPrimaryText: { color: colors.primary },
  chipNeutral: { backgroundColor: colors.surfaceMuted },
  chipNeutralText: { color: colors.textSecondary },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  eta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  etaText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  expiry: { fontSize: fontSize.sm, color: colors.textSecondary },
  expiryLow: { color: colors.warning, fontWeight: fontWeight.bold },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  fillLow: { backgroundColor: colors.accent },
  actions: { flexDirection: 'row', gap: spacing.sm },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  reject: { flex: 1 },
  accept: { flex: 1.6 },
});
