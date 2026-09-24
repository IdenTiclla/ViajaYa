import { Ionicons } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { OfferTag } from '@/features/rides/domain/offerTags';
import type { Offer } from '@/features/rides/domain/types';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import { Button, PersonAvatar } from '@/shared/components';
import { vehicleLabel } from '@/features/auth/domain/vehicleCatalog';

type Props = {
  offer: Offer;
  tag: OfferTag | null;
  now: number;
  acceptingId: string | null;
  decisionsLocked: boolean;
  onAccept: () => void;
  onReject: () => void;
};


/** Separate identity, price, arrival and expiry to compare offers. */
export function OfferCard({
  offer, tag, now, acceptingId, decisionsLocked, onAccept, onReject,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const { fontScale } = useWindowDimensions();
  const { driver } = offer;
  const seconds = offer.expiresAt == null
    ? null
    : Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000));
  const expired = seconds === 0;
  const accepting = acceptingId === offer.id;
  const locked = decisionsLocked || expired;
  const inColumn = fontScale > 1.3;
  const vehicle = [
    vehicleLabel(driver.vehicleType), driver.vehicleModel, driver.plate,
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {!inColumn && (
          <PersonAvatar name={driver.fullName} />
        )}
        <View style={styles.identity}>
          <Text style={styles.name}>{driver.fullName}</Text>
          {vehicle ? <Text style={styles.vehicle}>{vehicle}</Text> : null}
        </View>
      </View>

      <View style={styles.indicators}>
        <View style={styles.rating} accessible accessibilityLabel={driver.rating == null ? 'Sin calificaciones todavía' : `Calificación: ${driver.rating.toFixed(1)} de 5 estrellas`}>
          <Ionicons accessible={false} name="star" size={14} color={colors.primary} />
          <Text style={styles.indicatorText}>{driver.rating == null ? 'Sin calificaciones' : `${driver.rating.toFixed(1)} de 5`}</Text>
        </View>
        {tag && (
          <View style={styles.label}>
            <Ionicons accessible={false} name={tag.kind === 'cheapest' ? 'pricetag-outline' : tag.kind === 'fastest' ? 'time-outline' : 'star-outline'} size={14} color={colors.primary} />
            <Text style={styles.labelText}>{tag.subLabel}</Text>
          </View>
        )}
      </View>

      <View style={[styles.terms, inColumn && styles.column]}>
        <View style={styles.stat}>
          <Text style={styles.caption}>Precio total</Text>
          <Text style={styles.price}>Bs {formatBolivianos(offer.price)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.caption}>Llegada estimada</Text>
          <Text style={styles.arrival}>{offer.etaMin == null ? 'Sin estimación' : `${offer.etaMin} min`}</Text>
        </View>
      </View>

      <OfferLifeTimer secondsLeft={seconds} label="Oferta vence en" />

      <View style={[styles.actions, inColumn && styles.column]}>
        <Button
          title="Descartar"
          variant="secondary"
          onPress={onReject}
          disabled={locked}
          accessibilityLabel={`Descartar oferta de ${driver.fullName}`}
          style={!inColumn && styles.action}
        />
        <Button
          title={expired ? 'Oferta vencida' : 'Aceptar'}
          onPress={onAccept}
          disabled={locked}
          loading={accepting}
          loadingLabel="Aceptando…"
          accessibilityLabel={`Aceptar oferta de ${driver.fullName} por Bs ${formatBolivianos(offer.price)}`}
          style={!inColumn && styles.action}
        />
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  identity: { flex: 1, minWidth: 0, gap: spacing.xs },
  name: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },
  indicators: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  rating: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  indicatorText: { flexShrink: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  label: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.primarySoft, borderRadius: radius.sm },
  labelText: { flexShrink: 1, fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },
  terms: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md,
    padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  stat: { flexShrink: 1, gap: spacing.xs },
  caption: { fontSize: fontSize.xs, color: colors.textSecondary },
  price: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  arrival: { fontSize: fontSize.lg, color: colors.text, fontWeight: fontWeight.bold },
  actions: { flexDirection: 'row', gap: spacing.sm },
  column: { flexDirection: 'column' },
  action: { flex: 1 },
});
