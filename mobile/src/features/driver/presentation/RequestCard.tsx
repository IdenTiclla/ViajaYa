/**
 * Tarjeta de una solicitud entrante (conductor).
 *
 * - Tap en la tarjeta → abre el detalle del trayecto.
 * - Botones Contraofertar / Aceptar y un botón Rechazar (descartar).
 * - Se puede **descartar deslizando hacia la derecha** (revela el panel rojo).
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
        accessibilityLabel={`Ver detalle del trayecto, ${ride.service === 'taxi' ? 'taxi' : 'moto'}, Bs ${ride.fare.toFixed(2)}`}
        style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.serviceTag}>
            <Ionicons
              name={ride.service === 'taxi' ? 'car-sport' : 'bicycle'}
              size={16}
              color={colors.primary}
            />
            <Text style={styles.serviceText}>{ride.service === 'taxi' ? 'Taxi' : 'Moto'}</Text>
            <Text style={styles.distance}>· {formatKm(tripKm)}</Text>
          </View>
          <View style={styles.fareBox}>
            <Text style={styles.fare}>Bs {ride.fare.toFixed(2)}</Text>
            {perKm && <Text style={styles.perKm}>Bs {perKm}/km</Text>}
          </View>
        </View>

        <View style={styles.routeRow}>
          <Ionicons name="navigate-circle" size={18} color={colors.primary} />
          <Text style={styles.routeText} numberOfLines={1}>
            {ride.origin.name}
          </Text>
        </View>
        <View style={styles.routeRow}>
          <Ionicons name="location" size={18} color={colors.danger} />
          <Text style={styles.routeText} numberOfLines={1}>
            {ride.destination.name}
          </Text>
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
              <Ionicons name="close" size={16} color={colors.danger} />
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
    width: 104,
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
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  serviceTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  serviceText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  distance: { fontSize: fontSize.sm, color: colors.textSecondary },
  fareBox: { alignItems: 'flex-end' },
  fare: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  perKm: { fontSize: fontSize.xs, color: colors.textSecondary },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeText: { flex: 1, fontSize: fontSize.md, color: colors.text },

  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: { flex: 1, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  counter: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  counterText: { color: colors.primary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  accept: { backgroundColor: colors.primary },
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
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  offeredText: { fontSize: fontSize.sm, color: colors.textSecondary },

  reofferWrap: { gap: spacing.sm, marginTop: spacing.xs },
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
