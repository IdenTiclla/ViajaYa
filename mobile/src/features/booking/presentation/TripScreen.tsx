import { useDriverLocation } from '@/features/tracking/application/useDriverLocation';
import { DriverLocationStatus } from '@/features/tracking/presentation/DriverLocationStatus';
/**
 * Ride in progress (passenger) — tracking with a map (Stitch design
 * "Seguimiento del Viaje" / "Conductor en el origen").
 *
 * Shows the route on the map and a bottom card with the assigned
 * driver (vehicle, rating, plate) and Message / Call / Share actions.
 * Depending on the status, a banner says whether the driver is on the way or has arrived.
 * When completed, it goes straight to the full-screen rating (no intermediate
 * "Viaje finalizado" step); it allows cancelling before the ride starts.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { useBlockHardwareBack } from '@/core/navigation/useBlockHardwareBack';
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useTripActions, useTripContact } from '@/features/rides/application/useTripActions';
import {
  PASSENGER_ACTIVE_RIDE_KEY,
  useRide,
} from '@/features/rides/application/useRides';
import { usePickupRoute } from '@/features/rides/application/usePickupRoute';
import { formatKm } from '@/features/rides/domain/geo';
import { isPickupPhase } from '@/features/rides/domain/pickupRoute';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { TripProgress } from '@/features/rides/presentation/TripProgress';
import { TripSummary } from '@/features/rides/presentation/TripSummary';
import { TripSecondaryAction } from '@/features/rides/presentation/TripSecondaryAction';
import type { Ride, RideStatus } from '@/features/rides/domain/types';
import { Button, ConfirmDialog, FeedbackState, PersonAvatar } from '@/shared/components';
import { vehicleLabel } from '@/features/auth/domain/vehicleCatalog';


type Banner = { icon: IoniconsIconName; title: string; hint: string; accent?: boolean };

const BANNER: Record<RideStatus, Banner> = {
  searching: { icon: 'search', title: 'Buscando conductor', hint: 'Esperando ofertas…' },
  accepted: {
    icon: 'car-sport',
    title: 'Tu conductor está en camino',
    hint: 'Te avisaremos cuando llegue. Revisa su nombre y placa para reconocerlo.',
  },
  arriving: {
    icon: 'notifications',
    title: '¡Tu conductor llegó!',
    hint: 'Avísale que estás saliendo y ve al punto de recogida.',
    accent: true,
  },
  in_progress: { icon: 'navigate', title: 'Viaje en curso', hint: 'Disfruta tu viaje.' },
  completed: { icon: 'flag', title: 'Viaje finalizado', hint: '¡Gracias por viajar con ViajaYa!' },
  cancelled: { icon: 'close-circle', title: 'Viaje cancelado', hint: 'Este viaje fue cancelado.' },
};

const DELIVERY_BANNER: Record<RideStatus, Banner> = {
  searching: { icon: 'search', title: 'Buscando conductor', hint: 'Esperando ofertas…' },
  accepted: {
    icon: 'car-sport',
    title: 'Van por tu encomienda',
    hint: 'El conductor se dirige al punto de recogida.',
  },
  arriving: {
    icon: 'notifications',
    title: 'El conductor llegó',
    hint: 'Entrega la encomienda en el punto de partida.',
    accent: true,
  },
  in_progress: { icon: 'cube', title: 'Encomienda en camino', hint: 'Se dirige al destino.' },
  completed: { icon: 'flag', title: 'Entrega finalizada', hint: 'La encomienda llegó a destino.' },
  cancelled: { icon: 'close-circle', title: 'Entrega cancelada', hint: 'Esta entrega fue cancelada.' },
};

const CANCELLABLE: RideStatus[] = ['searching', 'accepted', 'arriving'];

export function TripScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;
  const { ride, isLoading, isError, error, refetch } = useRide(id);
  const tracking = useDriverLocation(ride);
  const actions = useTripActions(ride);
  const pickupPhase = Boolean(ride && isPickupPhase(ride.status));
  const vehicleLatitude = tracking.location?.latitude;
  const vehicleLongitude = tracking.location?.longitude;
  const vehicle = useMemo(() => vehicleLatitude != null && vehicleLongitude != null
    ? { latitude: vehicleLatitude, longitude: vehicleLongitude } : null, [vehicleLatitude, vehicleLongitude]);
  const { route: pickupRoute } = usePickupRoute(pickupPhase ? vehicle : null,
    pickupPhase ? ride?.origin.coordinates ?? null : null, ride?.service ?? 'taxi');
  const [confirmCancel, setConfirmCancel] = useState<{ id: string; status: RideStatus } | null>(null);
  const [sheetHeight, setSheetHeight] = useState(380);
  useBlockHardwareBack(Boolean(ride) && ride?.status !== 'cancelled');

  const goHome = () => router.dismissTo('/(app)/(tabs)');
  const closeAndGoHome = () => {
    queryClient.setQueryData<Ride | null>(PASSENGER_ACTIVE_RIDE_KEY, (current) => current?.id === id ? null : current);
    goHome();
  };

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
      <SafeAreaView style={styles.fallback}>
        <FeedbackState loading title="Cargando tu viaje…" />
        <Button title="Volver al inicio" variant="secondary" onPress={goHome} />
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={styles.fallback}>
        <FeedbackState
          icon="cloud-offline-outline"
          title="No pudimos cargar tu viaje"
          message={isError ? getApiErrorMessage(error) : 'El viaje no está disponible todavía.'}
          actionLabel="Reintentar"
          onAction={() => void refetch()}
        />
        <Button title="Volver al inicio" variant="secondary" onPress={goHome} />
      </SafeAreaView>
    );
  }

  // Completed (live notice over WS or on reopening): the rating screen already
  // closes the ride, so go there directly instead of flashing a "Calificar" step.
  if (ride.status === 'completed') {
    return <Redirect href={{ pathname: '/booking/rating', params: { rideId: ride.id } }} />;
  }

  const isDelivery = ride.service === 'delivery';
  const pickupAcknowledged = Boolean(ride.riderOnTheWayAt);
  const supportsPickupNotice = ride.service === 'taxi' || ride.service === 'moto';
  const atPickup = supportsPickupNotice && ride.status === 'arriving';
  const banner = atPickup && pickupAcknowledged
    ? { icon: 'checkmark-circle' as const, title: 'Tu conductor sabe que vas al punto',
        hint: 'Tu aviso fue enviado. Verifica su nombre y la placa antes de subir.' }
    : (isDelivery ? DELIVERY_BANNER : BANNER)[ride.status];
  const isCancelled = ride.status === 'cancelled';
  const canCancel = CANCELLABLE.includes(ride.status);

  return (
    <View style={styles.root}>
      <TripRouteMap phase={pickupPhase ? 'pickup' : 'trip'} vehicle={tracking.location ? { coordinates: tracking.location, heading: tracking.location.heading, type: ride.driver?.vehicleType ?? null, stale: tracking.freshness !== "live" } : undefined} service={ride.service} origin={ride.origin} destination={ride.destination} topPadding={48} bottomPadding={sheetHeight} />

      {isCancelled && (
        <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={closeAndGoHome}
            accessibilityRole="button"
            accessibilityLabel="Volver al inicio">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </SafeAreaView>
      )}

      <SafeAreaView style={styles.sheet} edges={['bottom']} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <ScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          bounces={false}>
        <View style={styles.sheetHandle} />
        <TripProgress status={ride.status} />

        <View accessibilityLiveRegion="polite" style={[styles.banner, banner.accent && styles.bannerAccent]}>
          <Ionicons
            name={ride.service === 'moto' && ride.status === 'accepted' ? 'bicycle' : banner.icon}
            size={26}
            color={banner.accent ? colors.textOnAccent : colors.primary}
          />
          <View style={styles.bannerText}>
            <Text accessibilityRole="header" style={[styles.bannerTitle, banner.accent && styles.bannerAccentText]}>{banner.title}</Text>
            <Text style={[styles.hint, banner.accent && styles.bannerAccentText]}>{banner.hint}</Text>
          </View>
        </View>
        {ride.status === 'accepted' && pickupRoute ? (
          <Text style={styles.hint}>
            Llega en {Math.max(1, Math.round(pickupRoute.durationSeconds / 60))} min · a {formatKm(pickupRoute.distanceMeters / 1000)} del punto de recogida.
          </Text>
        ) : ride.acceptedEtaMin != null && ride.status === 'accepted' && (
          <Text style={styles.hint}>Llegada estimada al aceptar: {ride.acceptedEtaMin} min.</Text>
        )}

        {ride.driver && <>
          {!isCancelled && <DriverLocationStatus freshness={tracking.freshness} onRetry={tracking.retry} />}
          <DriverCard ride={ride} />
        </>}
        <TripSummary key={ride.id} ride={ride} compact />

        {ride.status === 'searching' && (
          <Button title="Ver ofertas" onPress={() => router.replace({ pathname: '/booking/offers', params: { rideId: ride.id } })} />
        )}

        </ScrollView>
        {(atPickup || actions.error || isCancelled || canCancel) && <View style={styles.tripActions}>
        {atPickup && (
          <Button title={pickupAcknowledged ? 'Aviso enviado: voy al punto' : 'Ya salí, voy al punto'}
            leadingIcon={pickupAcknowledged ? 'checkmark-circle-outline' : 'walk-outline'}
            disabled={pickupAcknowledged || actions.busy} loading={actions.notifyingOnTheWay}
            loadingLabel="Enviando aviso…" onPress={actions.notifyOnTheWay} />
        )}
        {actions.error && (
          <Text accessibilityRole="alert" style={styles.error}>{actions.error}</Text>
        )}

        {isCancelled ? (
          <Button title="Volver al inicio" onPress={closeAndGoHome} />
        ) : canCancel ? (
          <TripSecondaryAction
            title={isDelivery ? 'Cancelar entrega' : 'Cancelar viaje'}
            disabled={actions.busy}
            onPress={() => setConfirmCancel({ id: ride.id, status: ride.status })}
          />
        ) : null}
        </View>}
      </SafeAreaView>

      <ConfirmDialog
        visible={confirmCancel?.id === ride.id && confirmCancel.status === ride.status && !actions.busy}
        icon="warning"
        destructive
        title={isDelivery ? '¿Cancelar entrega?' : '¿Cancelar viaje?'}
        message={
          ride.status === 'searching'
            ? 'Se cerrará la búsqueda y se retirarán las ofertas de los conductores.'
            : ride.status === 'arriving'
            ? 'Tu conductor ya está en el punto de recogida. Recibirá un aviso de la cancelación.'
            : isDelivery
            ? 'Tu conductor ya está en camino. Si cancelas ahora, se le notificará que la entrega fue cancelada.'
            : 'Tu conductor ya está en camino. Si cancelas ahora, se le notificará que el viaje fue cancelado.'
        }
        confirmText="Sí, cancelar"
        cancelText="Seguir"
        onConfirm={() => {
          if (!confirmCancel || confirmCancel.id !== ride.id) return;
          actions.cancel(confirmCancel.status);
          setConfirmCancel(null);
        }}
        onCancel={() => setConfirmCancel(null)}
      />
    </View>
  );
}

function DriverCard({ ride }: { ride: Ride }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const driver = ride.driver!;
  const contact = useTripContact(ride, driver.phone);
  const vehicle = [
    vehicleLabel(driver.vehicleType),
    driver.vehicleModel,
  ]
    .filter(Boolean)
    .join(' · ') || 'Datos del vehículo no registrados';

  return (
    <View style={styles.driverWrap}>
      <View style={styles.driverRow}>
        <PersonAvatar name={driver.fullName} size={48} />
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
        <ContactButton icon="chatbubble-outline" label="Mensaje" onPress={contact.message} disabled={!driver.phone} />
        <ContactButton icon="call-outline" label="Llamar" onPress={contact.call} disabled={!driver.phone} />
        <ContactButton icon="share-social-outline" label="Compartir" onPress={contact.share} />
      </View>
      {contact.error && <Text accessibilityRole="alert" style={styles.error}>{contact.error}</Text>}
    </View>
  );
}

function ContactButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IoniconsIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={[styles.contactBtn, disabled && styles.contactDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.contactLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  tripActions: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
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
    height: '46%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetContent: { padding: spacing.md, gap: spacing.sm },
  sheetHandle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: 'center' },

  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primarySoft, padding: spacing.sm, borderRadius: radius.md },
  bannerAccent: { backgroundColor: colors.accent },
  bannerAccentText: { color: colors.textOnAccent },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },

  driverWrap: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  driverRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  driverInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 140, gap: 2 },
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

  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  contactBtn: {
    flexGrow: 1,
    flexBasis: 80,
    minHeight: 48,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  contactDisabled: { opacity: 0.4 },
  contactLabel: { fontSize: fontSize.sm, color: colors.text },

  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
