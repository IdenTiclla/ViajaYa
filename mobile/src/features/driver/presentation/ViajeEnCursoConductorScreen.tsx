/**
 * Viaje en curso (conductor) — navegación con mapa (diseños Stitch
 * "En Camino a Recogida", "Llegada y Comienzo", "Navegación de Viaje").
 *
 * Mapa con el trayecto y un banner de navegación arriba; abajo, las direcciones
 * y un botón único que progresa el ciclo de vida: Llegué → Iniciar → Finalizar
 * (`PATCH /rides/{id}/status`). Al completarse, califica al pasajero.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useRoute } from '@/features/booking/application/useRoute';
import { useCancelRide, useUpdateRideStatus } from '@/features/rides/application/useRideMutations';
import { RideRatingCard } from '@/features/rides/presentation/RideRatingCard';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import type { Ride, RideStatus } from '@/features/rides/domain/types';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

// Siguiente acción según el estado actual del viaje.
const NEXT: Partial<Record<RideStatus, { label: string; status: RideStatus }>> = {
  accepted: { label: 'He llegado al punto de partida', status: 'arriving' },
  arriving: { label: 'Iniciar viaje', status: 'in_progress' },
  in_progress: { label: 'Finalizar viaje', status: 'completed' },
};

// Banner de navegación: a dónde se dirige el conductor en cada estado.
function navTarget(ride: Ride): { title: string; place: string } {
  if (ride.status === 'in_progress') {
    return { title: 'Llevando al pasajero a', place: ride.destination.name };
  }
  if (ride.status === 'arriving') {
    return { title: 'Esperando al pasajero en', place: ride.origin.name };
  }
  return { title: 'Recoger al pasajero en', place: ride.origin.name };
}

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function ViajeEnCursoConductorScreen({ ride }: { ride: Ride }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateStatus = useUpdateRideStatus();
  const cancelRide = useCancelRide();
  const { route } = useRoute(ride.origin, ride.destination);

  // El pasajero (o el propio conductor) canceló: avisar y volver a solicitudes.
  if (ride.status === 'cancelled') {
    const dismiss = () => {
      // Despeja el viaje activo de inmediato para volver al flujo de solicitudes.
      queryClient.setQueryData(['driver-active-ride'], null);
      router.replace('/(driver)/(tabs)/solicitudes');
    };
    return (
      <SafeAreaView style={styles.cancelledRoot}>
        <View style={styles.cancelledIcon}>
          <Ionicons name="close-circle" size={48} color={colors.danger} />
        </View>
        <Text style={styles.cancelledTitle}>Viaje cancelado</Text>
        <Text style={styles.cancelledHint}>
          Este viaje fue cancelado. No te preocupes: hay más solicitudes esperándote.
        </Text>
        <TouchableOpacity
          style={styles.cancelledBtn}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Volver a solicitudes">
          <Ionicons name="compass" size={20} color={colors.textOnPrimary} />
          <Text style={styles.cancelledBtnText}>Volver a solicitudes</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Al completarse, el conductor califica al pasajero antes de volver a su panel.
  if (ride.status === 'completed') {
    return (
      <SafeAreaView style={styles.ratingRoot}>
        <RideRatingCard
          ride={ride}
          rateeRole="passenger"
          onDone={() => router.replace('/(driver)/(tabs)')}
        />
      </SafeAreaView>
    );
  }

  const next = NEXT[ride.status];
  const canCancel = ride.status === 'accepted' || ride.status === 'arriving';
  const target = navTarget(ride);
  const distanceKm = route ? (route.distanceMeters / 1000).toFixed(1) : null;

  return (
    <View style={styles.root}>
      <TripRouteMap origin={ride.origin} destination={ride.destination} bottomPadding={360} />

      <SafeAreaView edges={['top']} style={styles.navBannerWrap} pointerEvents="box-none">
        <View style={styles.navBanner}>
          <View style={styles.navIcon}>
            <Ionicons name="navigate" size={22} color={colors.textOnPrimary} />
          </View>
          <View style={styles.navText}>
            <Text style={styles.navTitle}>{target.title}</Text>
            <Text style={styles.navPlace} numberOfLines={1}>
              {target.place}
            </Text>
          </View>
          {route && (
            <View style={styles.navMeta}>
              <Text style={styles.navMetaValue}>{formatDuration(route.durationSeconds)}</Text>
              {distanceKm && <Text style={styles.navMetaSub}>{distanceKm} km</Text>}
            </View>
          )}
        </View>
      </SafeAreaView>

      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.sheetHandle} />

        <View style={styles.header}>
          <View style={styles.serviceBadge}>
            <Ionicons
              name={ride.service === 'taxi' ? 'car-sport' : 'bicycle'}
              size={18}
              color={colors.primary}
            />
            <Text style={styles.serviceBadgeText}>{SERVICE_LABELS[ride.service]}</Text>
          </View>
          <Text style={styles.price}>Bs {(ride.acceptedPrice ?? ride.fare).toFixed(2)}</Text>
        </View>

        <View style={styles.routeCard}>
          <Row icon="navigate-circle" color={colors.primary} label="Recoger en" value={ride.origin.name} />
          <Row icon="location" color={colors.danger} label="Destino" value={ride.destination.name} />
          <Row
            icon="card"
            color={colors.textSecondary}
            label="Pago"
            value={ride.payment === 'qr' ? 'QR' : 'Efectivo'}
          />
        </View>

        {(updateStatus.isError || cancelRide.isError) && (
          <Text style={styles.error}>
            {getApiErrorMessage(updateStatus.error ?? cancelRide.error)}
          </Text>
        )}

        {next && (
          <TouchableOpacity
            style={[styles.primaryBtn, updateStatus.isPending && styles.disabled]}
            onPress={() => updateStatus.mutate({ rideId: ride.id, status: next.status })}
            disabled={updateStatus.isPending}
            accessibilityRole="button"
            accessibilityLabel={next.label}>
            <Ionicons name="checkmark-circle" size={20} color={colors.textOnPrimary} />
            <Text style={styles.primaryText}>{next.label}</Text>
          </TouchableOpacity>
        )}
        {canCancel && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => cancelRide.mutate(ride.id)}
            disabled={cancelRide.isPending}
            accessibilityRole="button"
            accessibilityLabel="Cancelar viaje">
            <Text style={styles.cancelText}>Cancelar viaje</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}

function Row({
  icon,
  color,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  ratingRoot: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },

  cancelledRoot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  cancelledIcon: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelledTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  cancelledHint: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  cancelledBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  cancelledBtnText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },

  navBannerWrap: { position: 'absolute', top: 0, left: 0, right: 0, padding: spacing.md },
  navBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { flex: 1, gap: 2 },
  navTitle: { fontSize: fontSize.xs, color: colors.textSecondary },
  navPlace: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  navMeta: { alignItems: 'flex-end' },
  navMetaValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  navMetaSub: { fontSize: fontSize.xs, color: colors.textSecondary },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  serviceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  serviceBadgeText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  price: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },

  routeCard: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1 },
  rowLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  rowValue: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  disabled: { opacity: 0.5 },
  cancelBtn: { alignItems: 'center', paddingVertical: spacing.xs },
  cancelText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
