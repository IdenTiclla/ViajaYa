/**
 * Tarjeta de una solicitud entrante (conductor) — diseño Material-You glass.
 *
 * Muestra los datos públicos del pasajero (nombre, rating, viajes completados),
 * el trayecto origen→destino con su distancia y el precio ofertado. Acciones:
 * Contraofertar (modal) / Aceptar (oferta al precio del pasajero). Se puede
 * **rechazar deslizando** a la derecha (panel rojo) o con el botón. Estados
 * `offered`/`rejected` preservados del flujo de multi-oferta.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import type { OpenRide } from '@/features/rides/domain/types';

const PAYMENT_LABELS = { qr: 'QR', cash: 'Efectivo' } as const;

type Props = {
  ride: OpenRide;
  offered: boolean;
  rejected: boolean;
  disabled: boolean;
  onPress: () => void;
  onAccept: () => void;
  onCounter: () => void;
  onDismiss: () => void;
};

export function RequestCard({
  ride,
  offered,
  rejected,
  disabled,
  onPress,
  onAccept,
  onCounter,
  onDismiss,
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
            <View style={styles.tripMeta}>
              <Ionicons name="navigate-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.tripMetaText}>Viaje de {formatKm(tripKm)}</Text>
            </View>
          </View>
          <View style={styles.priceCol}>
            <Text style={styles.fare}>Bs {ride.fare.toFixed(2)}</Text>
            {perKm && <Text style={styles.perKm}>Bs {perKm}/km</Text>}
          </View>
        </View>

        <View style={styles.route}>
          <View style={styles.routeDots}>
            <View style={styles.dotOrigin} />
            <View style={styles.trackLine} />
            <Ionicons name="location" size={16} color={colors.danger} />
          </View>
          <View style={styles.routeTexts}>
            <Text style={styles.routeText} numberOfLines={1}>
              {ride.origin.name}
            </Text>
            <Text style={[styles.routeText, styles.routeDest]} numberOfLines={1}>
              {ride.destination.name}
            </Text>
          </View>
        </View>

        {rejected ? (
          <View style={styles.reofferWrap}>
            <View style={styles.rejectedBox}>
              <Ionicons name="close-circle" size={18} color={colors.danger} />
              <Text style={styles.rejectedText}>
                El pasajero rechazó tu oferta · mejórala o vuelve a enviarla
              </Text>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.counter, disabled && styles.disabled]}
                onPress={onCounter}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Mejorar oferta">
                <Text style={styles.counterText}>Mejorar oferta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
                onPress={onAccept}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Ofertar de nuevo por Bs ${ride.fare.toFixed(2)}`}>
                <Text style={styles.acceptText}>Ofertar de nuevo</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : offered ? (
          <View style={styles.offeredBox}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.offeredText}>Oferta enviada · toca para ver el estado</Text>
          </View>
        ) : (
          <>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.counter, disabled && styles.disabled]}
                onPress={onCounter}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Contraofertar">
                <Text style={styles.counterText}>Contraofertar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
                onPress={onAccept}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Aceptar por Bs ${ride.fare.toFixed(2)}`}>
                <Text style={styles.acceptText}>Aceptar</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={onDismiss}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Rechazar solicitud">
              <Ionicons name="close" size={14} color={colors.danger} />
              <Text style={styles.rejectText}>Rechazar</Text>
            </TouchableOpacity>
          </>
        )}
      </TouchableOpacity>
    </ReanimatedSwipeable>
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
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
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

  cardInfo: { flex: 1, gap: 3 },
  riderName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary },
  tripMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tripMetaText: { fontSize: fontSize.xs, color: colors.textSecondary },

  priceCol: { alignItems: 'flex-end', justifyContent: 'center' },
  fare: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  perKm: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.semibold, marginTop: 2 },

  route: { flexDirection: 'row', gap: spacing.sm },
  routeDots: { alignItems: 'center', gap: 2, paddingTop: 2 },
  dotOrigin: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.primary },
  trackLine: { width: 2, height: 14, backgroundColor: colors.border },
  routeTexts: { flex: 1, gap: spacing.sm },
  routeText: { fontSize: fontSize.sm, color: colors.text },
  routeDest: { fontWeight: fontWeight.semibold },

  cardActions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  counterText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  accept: { backgroundColor: colors.primary, flex: 1.6 },
  acceptText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  disabled: { opacity: 0.5 },

  rejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  rejectText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  offeredBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  offeredText: { fontSize: fontSize.sm, color: colors.textSecondary },

  reofferWrap: { gap: spacing.sm },
  rejectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: '#FDECEA',
  },
  rejectedText: { flex: 1, fontSize: fontSize.sm, color: colors.danger, fontWeight: fontWeight.medium },
});
