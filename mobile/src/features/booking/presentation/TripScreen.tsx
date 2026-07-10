/**
 * Viaje en curso (pasajero) — seguimiento con mapa (diseño Stitch
 * "Seguimiento del Viaje" / "Conductor en Punto de Partida").
 *
 * Muestra el trayecto en el mapa y una tarjeta inferior con el conductor
 * asignado (vehículo, rating, placa) y acciones Mensaje / Llamar / Compartir.
 * Según el estado, un banner indica si el conductor va en camino o ya llegó.
 * Al completarse, lleva a calificar; permite cancelar antes de iniciar.
 */
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useCancelRide } from '@/features/rides/application/useRideMutations';
import {
  PASSENGER_ACTIVE_RIDE_KEY,
  useRide,
} from '@/features/rides/application/useRides';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import type { Ride, RideStatus } from '@/features/rides/domain/types';
import { Button, ConfirmDialog } from '@/shared/components';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

type Banner = { icon: keyof typeof Ionicons.glyphMap; title: string; hint: string; accent?: boolean };

const BANNER: Record<RideStatus, Banner> = {
  searching: { icon: 'search', title: 'Buscando conductor', hint: 'Esperando ofertas…' },
  accepted: {
    icon: 'car-sport',
    title: 'Tu conductor está en camino',
    hint: 'Se dirige al punto de partida.',
  },
  arriving: {
    icon: 'notifications',
    title: '¡Tu conductor llegó!',
    hint: 'Espéralo en el punto de partida.',
    accent: true,
  },
  in_progress: { icon: 'navigate', title: 'Viaje en curso', hint: 'Disfruta tu viaje.' },
  completed: { icon: 'flag', title: 'Viaje finalizado', hint: '¡Gracias por viajar con ViajaYa!' },
  cancelled: { icon: 'close-circle', title: 'Viaje cancelado', hint: 'Este viaje fue cancelado.' },
};

const CANCELLABLE: RideStatus[] = ['searching', 'accepted', 'arriving'];

export function TripScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;
  const { ride, isLoading } = useRide(id);
  const cancelRide = useCancelRide();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const goHome = () => router.replace('/(app)/(tabs)');
  const closeAndGoHome = () => {
    queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY, null);
    goHome();
  };
  const goRate = () => router.replace(`/(app)/booking/rating?rideId=${id}`);

  // Al completarse el viaje (aviso en vivo por WS), lleva a calificar tras una
  // breve pausa para que el pasajero vea el banner de "Viaje finalizado".
  const completed = ride?.status === 'completed';
  useEffect(() => {
    if (!completed || !id) return;
    const timer = setTimeout(
      () => router.replace(`/(app)/booking/rating?rideId=${id}`),
      1500,
    );
    return () => clearTimeout(timer);
  }, [completed, id, router]);

  if (!id) {
    return (
      <SafeAreaView style={[styles.fallback, styles.center]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.hint}>El viaje solicitado no es válido.</Text>
        <View style={styles.fallbackAction}>
          <Button title="Volver al inicio" onPress={goHome} />
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading && !ride) {
    return (
      <SafeAreaView style={[styles.fallback, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={[styles.fallback, styles.center]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.hint}>No pudimos cargar el viaje.</Text>
        <View style={styles.fallbackAction}>
          <Button title="Volver al inicio" onPress={goHome} />
        </View>
      </SafeAreaView>
    );
  }

  const banner = BANNER[ride.status];
  const isCompleted = ride.status === 'completed';
  const isCancelled = ride.status === 'cancelled';
  const canCancel = CANCELLABLE.includes(ride.status);

  return (
    <View style={styles.root}>
      <TripRouteMap origin={ride.origin} destination={ride.destination} bottomPadding={380} />

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={goHome}
          accessibilityRole="button"
          accessibilityLabel="Volver al inicio">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
      </SafeAreaView>

      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.sheetHandle} />

        <View style={[styles.banner, banner.accent && styles.bannerAccent]}>
          <Ionicons
            name={banner.icon}
            size={26}
            color={banner.accent ? colors.text : colors.primary}
          />
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.hint}>{banner.hint}</Text>
          </View>
          {ride.acceptedEtaMin != null && ride.status === 'accepted' && (
            <View style={styles.etaBox}>
              <Text style={styles.etaValue}>{ride.acceptedEtaMin}</Text>
              <Text style={styles.etaLabel}>min</Text>
            </View>
          )}
        </View>

        {ride.driver && <DriverCard ride={ride} />}

        {cancelRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(cancelRide.error)}</Text>
        )}

        {isCompleted ? (
          <Button title="Calificar viaje" onPress={goRate} />
        ) : isCancelled ? (
          <Button title="Volver al inicio" onPress={closeAndGoHome} />
        ) : canCancel ? (
          <Button
            title="Cancelar viaje"
            variant="secondary"
            loading={cancelRide.isPending}
            onPress={() => setConfirmCancel(true)}
          />
        ) : null}
      </SafeAreaView>

      <ConfirmDialog
        visible={confirmCancel}
        icon="warning"
        destructive
        title="¿Cancelar viaje?"
        message="Tu conductor ya está en camino. Si cancelas ahora, se le notificará que el viaje fue cancelado."
        confirmText="Sí, cancelar"
        cancelText="Seguir"
        onConfirm={() => {
          setConfirmCancel(false);
          if (id) cancelRide.mutate(id);
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </View>
  );
}

function DriverCard({ ride }: { ride: Ride }) {
  const driver = ride.driver!;
  const vehicle = [
    driver.vehicleType ? SERVICE_LABELS[driver.vehicleType] : null,
    driver.vehicleModel,
  ]
    .filter(Boolean)
    .join(' · ');

  const call = () => {
    if (driver.phone) void Linking.openURL(`tel:${driver.phone}`);
  };
  const message = () => {
    if (driver.phone) void Linking.openURL(`sms:${driver.phone}`);
  };
  const share = () => {
    void Share.share({
      message: `Estoy viajando con ViajaYa: ${ride.origin.name} → ${ride.destination.name}. Conductor: ${driver.fullName}.`,
    });
  };

  return (
    <View style={styles.driverWrap}>
      <View style={styles.driverRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {driver.fullName.trim().charAt(0).toUpperCase() || 'C'}
          </Text>
        </View>
        <View style={styles.driverInfo}>
          <Text style={styles.driverName}>{driver.fullName}</Text>
          {!!vehicle && <Text style={styles.vehicle}>{vehicle}</Text>}
          {driver.rating != null && (
            <View style={styles.rating}>
              <Ionicons name="star" size={13} color={colors.accent} />
              <Text style={styles.ratingText}>{driver.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
        {!!driver.plate && (
          <View style={styles.plate}>
            <Text style={styles.plateText}>{driver.plate}</Text>
          </View>
        )}
      </View>

      <View style={styles.contactRow}>
        <ContactButton icon="chatbubble-outline" label="Mensaje" onPress={message} disabled={!driver.phone} />
        <ContactButton icon="call-outline" label="Llamar" onPress={call} disabled={!driver.phone} />
        <ContactButton icon="share-social-outline" label="Compartir" onPress={share} />
      </View>
    </View>
  );
}

function ContactButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.contactBtn, disabled && styles.contactDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.contactLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  fallback: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  center: { alignItems: 'center', justifyContent: 'center' },
  fallbackAction: { alignSelf: 'stretch', marginTop: spacing.md },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },

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

  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bannerAccent: { backgroundColor: colors.accent, padding: spacing.md, borderRadius: radius.md },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  etaBox: { alignItems: 'center' },
  etaValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.primary },
  etaLabel: { fontSize: fontSize.xs, color: colors.textSecondary },

  driverWrap: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  driverInfo: { flex: 1, gap: 2 },
  driverName: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: fontSize.sm, color: colors.textSecondary },
  plate: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  plateText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text, letterSpacing: 1 },

  contactRow: { flexDirection: 'row', gap: spacing.sm },
  contactBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  contactDisabled: { opacity: 0.4 },
  contactLabel: { fontSize: fontSize.xs, color: colors.text },

  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
