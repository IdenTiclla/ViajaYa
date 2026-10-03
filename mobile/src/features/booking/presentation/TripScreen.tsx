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
import { useRoute } from '@/features/booking/application/useRoute';
import { useBlockHardwareBack } from '@/core/navigation/useBlockHardwareBack';
import { useNow } from '@/core/hooks/useNow';
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
import { TripSecondaryAction } from '@/features/rides/presentation/TripSecondaryAction';
import { ContactIconButton, formatElapsed, PaymentNote, PlateBadge, RouteLine } from '@/features/rides/presentation/TripParts';
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
  const travelling = ride?.status === 'in_progress';
  const { route: tripRoute } = usePickupRoute(travelling ? vehicle : null,
    travelling ? ride?.destination.coordinates ?? null : null, ride?.service ?? 'taxi');
  const contact = useTripContact(ride, ride?.driver?.phone);
  // Full origin → destination route (shared cache with the map) to show trip progress.
  const { route: fullRoute } = useRoute(travelling ? ride?.origin ?? null : null,
    travelling ? ride?.destination ?? null : null, ride?.service ?? 'taxi');
  const now = useNow(ride?.status === 'arriving' ? 1000 : 30_000);
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

  const driver = ride.driver;
  const firstName = driver?.fullName.trim().split(/\s+/)[0] ?? 'Tu conductor';
  const pickupMinutes = pickupRoute ? Math.max(1, Math.round(pickupRoute.durationSeconds / 60)) : ride.acceptedEtaMin;
  const tripMinutes = tripRoute ? Math.max(1, Math.round(tripRoute.durationSeconds / 60)) : null;
  const arrivalClock = tripMinutes != null ? formatClock(now + tripMinutes * 60_000) : null;

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
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          bounces={false}>
        <View style={styles.sheetHandle} />
        <TripProgress status={ride.status} />

        {ride.status === 'arriving' ? (
          <View accessibilityLiveRegion="assertive" style={styles.arrival}>
            <View style={styles.arrivalHeader}>
              <View style={styles.arrivalIcon}>
                <Ionicons name={pickupAcknowledged ? 'checkmark-circle' : 'notifications'} size={26} color={colors.textOnAccent} />
              </View>
              <View style={styles.flex}>
                <Text accessibilityRole="header" style={styles.arrivalTitle}>{banner.title}</Text>
                {ride.arrivedAt && !pickupAcknowledged && (
                  <Text style={styles.arrivalWait}>Te espera desde hace {formatElapsed(ride.arrivedAt, now)}</Text>
                )}
                <Text style={styles.arrivalHint}>{banner.hint}</Text>
              </View>
            </View>
            {driver && (
              <View style={styles.lookFor}>
                <View style={styles.flex}>
                  <Text style={styles.lookForLabel}>Busca</Text>
                  <Text style={styles.lookForVehicle}>
                    {[vehicleLabel(driver.vehicleType), driver.vehicleModel].filter(Boolean).join(' · ') || driver.fullName}
                  </Text>
                </View>
                {!!driver.plate && <PlateBadge plate={driver.plate} large />}
              </View>
            )}
          </View>
        ) : ride.status === 'accepted' ? (
          <View accessibilityLiveRegion="polite" style={styles.hero}>
            <Text style={styles.heroLabel}>{banner.title}</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              {pickupMinutes != null ? `Llega en ${pickupMinutes} min` : 'En camino'}
            </Text>
            <Text style={styles.heroHint}>
              {pickupRoute ? `A ${formatKm(pickupRoute.distanceMeters / 1000)} · ` : ''}te avisaremos cuando llegue
            </Text>
          </View>
        ) : ride.status === 'in_progress' ? (
          <View accessibilityLiveRegion="polite" style={styles.hero}>
            <Text style={styles.heroLabel}>{isDelivery ? 'Encomienda en camino a' : 'Viaje en curso a'} {ride.destination.name}</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              {arrivalClock ? `${isDelivery ? 'Llega' : 'Llegas'} a las ${arrivalClock}` : banner.title}
            </Text>
            {tripRoute && (
              <View style={styles.progressRow}>
                {fullRoute && fullRoute.distanceMeters > 0 && (
                  <View style={styles.progressTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, Math.max(0.04,
                      1 - tripRoute.distanceMeters / fullRoute.distanceMeters)) * 100)}%` }]} />
                  </View>
                )}
                <Text style={styles.heroHint}>{tripMinutes} min · {formatKm(tripRoute.distanceMeters / 1000)}</Text>
              </View>
            )}
          </View>
        ) : (
          <View accessibilityLiveRegion="polite" style={[styles.banner, banner.accent && styles.bannerAccent]}>
            <Ionicons name={banner.icon} size={26} color={banner.accent ? colors.textOnAccent : colors.primary} />
            <View style={styles.bannerText}>
              <Text accessibilityRole="header" style={[styles.bannerTitle, banner.accent && styles.bannerAccentText]}>{banner.title}</Text>
              <Text style={[styles.hint, banner.accent && styles.bannerAccentText]}>{banner.hint}</Text>
            </View>
          </View>
        )}

        {driver && !isCancelled && tracking.freshness !== 'live' && (
          <DriverLocationStatus freshness={tracking.freshness} onRetry={tracking.retry} />
        )}
        {driver && (ride.status === 'accepted' || isCancelled) && <DriverCard ride={ride} />}
        {driver && (ride.status === 'arriving' || ride.status === 'in_progress') && (
          <DriverRow ride={ride} firstName={firstName} />
        )}
        {ride.status === 'in_progress' && <PaymentNote ride={ride} role="passenger" />}
        {ride.status === 'in_progress' && (
          <Button title={isDelivery ? 'Compartir la entrega' : 'Compartir mi viaje'} variant="secondary"
            leadingIcon="share-social-outline" onPress={contact.share} />
        )}
        {(ride.status === 'accepted' || ride.status === 'searching' || isCancelled) && <RouteLine ride={ride} />}

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

/** Compact driver row with call and message once the passenger has spotted them. */
function DriverRow({ ride, firstName }: { ride: Ride; firstName: string }) {
  const { styles } = useThemedStyles(createStyles);
  const driver = ride.driver!;
  const contact = useTripContact(ride, driver.phone);
  return (
    <View style={styles.driverRowWrap}>
      <View style={styles.driverRowLine}>
        <PersonAvatar name={driver.fullName} size={44} />
        <View style={styles.driverInfo}>
          <Text style={styles.driverName}>{driver.fullName}</Text>
          <Text style={styles.vehicle} numberOfLines={1}>
            {ride.status === 'arriving'
              ? `En ${ride.origin.name}`
              : [driver.vehicleModel, driver.plate].filter(Boolean).join(' · ') || vehicleLabel(driver.vehicleType)}
          </Text>
        </View>
        <ContactIconButton icon="chatbubble-outline" label={`Enviar mensaje a ${firstName}`}
          onPress={contact.message} disabled={!driver.phone} />
        <ContactIconButton icon="call-outline" label={`Llamar a ${firstName}`}
          onPress={contact.call} disabled={!driver.phone} />
      </View>
      {contact.error && <Text accessibilityRole="alert" style={styles.error}>{contact.error}</Text>}
    </View>
  );
}

function formatClock(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
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
        {!!driver.plate && <PlateBadge plate={driver.plate} />}
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
    maxHeight: '64%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetContent: { padding: spacing.md, gap: spacing.sm },
  sheetHandle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: 'center' },

  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primarySoft, padding: spacing.sm, borderRadius: radius.md },
  bannerAccent: { backgroundColor: colors.accent },
  bannerAccentText: { color: colors.textOnAccent },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  flex: { flex: 1, minWidth: 0 },
  hero: { gap: 2 },
  heroLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.textSecondary },
  heroHint: { fontSize: fontSize.sm, color: colors.textSecondary },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  heroTitle: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
  arrival: { gap: spacing.sm + 4, padding: spacing.md, borderRadius: 18, backgroundColor: colors.accent },
  arrivalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  arrivalIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrivalTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.textOnAccent },
  arrivalHint: { fontSize: fontSize.sm, color: colors.textOnAccent },
  arrivalWait: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textOnAccent },
  lookFor: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  lookForLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  lookForVehicle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  driverRowWrap: { gap: spacing.xs },
  driverRowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },

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
