/**
 * Driver pickup, travel and closing. Stage 2 opens with "¡Viaje confirmado!";
 * each stage advances with a deliberate swipe, and cancelling keeps its dialog.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBlockHardwareBack } from '@/core/navigation/useBlockHardwareBack';
import { useNow } from '@/core/hooks/useNow';
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useTripActions, useTripContact } from '@/features/rides/application/useTripActions';
import { DRIVER_ACTIVE_RIDE_KEY } from '@/features/rides/application/useRides';
import { usePickupRoute } from '@/features/rides/application/usePickupRoute';
import { formatKm } from '@/features/rides/domain/geo';
import { isPickupPhase } from '@/features/rides/domain/pickupRoute';
import { serviceNouns } from '@/features/rides/domain/serviceNouns';
import type { Ride, RideStatus } from '@/features/rides/domain/types';
import { RideRatingCard } from '@/features/rides/presentation/RideRatingCard';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { TripProgress } from '@/features/rides/presentation/TripProgress';
import { RideConfirmedScreen } from '@/features/rides/presentation/RideConfirmedScreen';
import { ContactIconButton, formatElapsed, PaymentNote, RouteLine } from '@/features/rides/presentation/TripParts';
import { TripSecondaryAction } from '@/features/rides/presentation/TripSecondaryAction';
import { Button, ConfirmDialog, FeedbackState, PersonAvatar, SwipeToConfirm } from '@/shared/components';
import { useConfirmedRides } from '@/features/driver/application/useConfirmedRides';

import { DriverNavigationActions } from '@/features/navigation/presentation/DriverNavigationActions';
import { DriverSharingStatus } from '@/features/tracking/presentation/DriverSharingStatus';
import { useLocationSharingStore } from '@/features/tracking/application/locationSharingStore';

type Confirmation = { rideId: string; status: RideStatus };

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function formatClock(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function minutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

/** Swipe label of the action that advances each stage. */
function advanceLabel(ride: Ride) {
  if (ride.status === 'accepted') return 'Desliza: ya llegué';
  if (ride.status === 'arriving') {
    return ride.service === 'delivery' ? 'Desliza: iniciar entrega'
      : ride.service === 'moving' ? 'Desliza: iniciar mudanza' : 'Desliza: iniciar viaje';
  }
  return ride.service === 'delivery' ? 'Desliza: confirmar entrega' : 'Desliza: finalizar viaje';
}

// Same as the passenger's confirmation: it moves on to navigation by itself.
const CONFIRMATION_AUTO_CONTINUE_MS = 6000;

export function DriverTripInProgressScreen({ ride }: { ride: Ride }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const sharing = useLocationSharingStore();
  const actions = useTripActions(ride);
  const contact = useTripContact(ride, ride.rider.phone);
  const confirmationSeen = useConfirmedRides((state) => state.seen.includes(ride.id));
  const markConfirmationSeen = useConfirmedRides((state) => state.markSeen);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [sheetHeight, setSheetHeight] = useState(440);
  const pickupPhase = isPickupPhase(ride.status);
  const travelling = ride.status === 'in_progress';
  const vehicle = sharing.rideId === ride.id && sharing.coordinates ? sharing.coordinates : null;
  const { route: pickupRoute } = usePickupRoute(pickupPhase ? vehicle : null, pickupPhase ? ride.origin.coordinates : null, ride.service);
  const { route: tripRoute } = usePickupRoute(travelling ? vehicle : null, travelling ? ride.destination.coordinates : null, ride.service);
  const nouns = serviceNouns(ride.service);
  const now = useNow(ride.status === 'arriving' ? 1000 : 30_000);
  const customer = firstName(ride.rider.fullName);
  // The flow is closed explicitly (rating or "Volver a solicitudes"), never with back.
  useBlockHardwareBack(true);

  const close = async (rated = false) => {
    // Rating mutations already reconcile both caches before invoking onDone.
    if (!rated) {
      await queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY }, { revert: false });
      queryClient.setQueryData<Ride | null>(DRIVER_ACTIVE_RIDE_KEY,
        (current) => current?.id === ride.id ? null : current);
    }
    router.replace('/(driver)/(tabs)/requests');
  };
  const currentConfirmation = confirmation?.rideId === ride.id && confirmation.status === ride.status
    ? confirmation : null;

  if (ride.status === 'cancelled') return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.resultContent}>
        <FeedbackState compact icon="close-circle-outline" title={`${ride.service === 'delivery' ? 'Entrega cancelada' : 'Viaje cancelado'}`}
          message="El servicio ya no está activo. Puedes volver a revisar las solicitudes disponibles." />
        <Button title="Volver a solicitudes" onPress={() => close()} />
      </ScrollView>
    </SafeAreaView>
  );

  if (ride.status === 'completed') return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.ratingContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <RideRatingCard key={ride.id} ride={ride} rateeRole="passenger"
            counterpartName={ride.rider.fullName} onDone={() => close(true)} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  // Stage 2 opens with the same confirmation the passenger sees.
  if (ride.status === 'accepted' && !confirmationSeen) return (
    <RideConfirmedScreen ride={ride} role="driver" actionLabel="Ir a recoger"
      pickupHint={pickupRoute ? `A ${formatKm(pickupRoute.distanceMeters / 1000)} · ${minutes(pickupRoute.durationSeconds)} min` : null}
      autoContinueMs={CONFIRMATION_AUTO_CONTINUE_MS}
      onContinue={() => markConfirmationSeen(ride.id)} />
  );

  const canCancel = ride.status === 'accepted' || ride.status === 'arriving';
  const canAdvance = canCancel || travelling;
  const isDelivery = ride.service === 'delivery';
  const tripMinutes = tripRoute ? minutes(tripRoute.durationSeconds) : null;

  return (
    <View style={styles.root}>
      <TripRouteMap phase={pickupPhase ? 'pickup' : 'trip'} vehicle={vehicle ? { coordinates: vehicle, heading: sharing.heading, type: ride.driver?.vehicleType ?? null } : undefined} service={ride.service} origin={ride.origin} destination={ride.destination} topPadding={48} bottomPadding={sheetHeight} />
      <SafeAreaView style={styles.sheet} edges={['bottom']} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <View style={styles.handle} />
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} bounces={false}>
          <TripProgress status={ride.status} />

          <View style={styles.hero} accessibilityLiveRegion="polite">
            {ride.status === 'accepted' ? <>
              <Text style={styles.heroLabel}>Ve al punto de recogida</Text>
              <Text accessibilityRole="header" style={styles.heroTitle}>{ride.origin.name}</Text>
              {pickupRoute && <Text style={styles.heroStrong}>
                A {formatKm(pickupRoute.distanceMeters / 1000)} · {minutes(pickupRoute.durationSeconds)} min
              </Text>}
            </> : ride.status === 'arriving' ? <>
              <View style={styles.waitRow}>
                <View style={styles.waitText}>
                  <Text style={styles.heroLabel}>Estás en el punto de recogida</Text>
                  <Text accessibilityRole="header" style={styles.heroTitle}>
                    {isDelivery ? 'Recibe la encomienda' : `Esperando a ${customer}`}
                  </Text>
                </View>
                {ride.arrivedAt && (
                  <View style={styles.waitBox} accessible
                    accessibilityLabel={`Esperando desde hace ${formatElapsed(ride.arrivedAt, now)}`}>
                    <Text style={styles.waitValue}>{formatElapsed(ride.arrivedAt, now)}</Text>
                    <Text style={styles.waitLabel}>esperando</Text>
                  </View>
                )}
              </View>
              <View style={[styles.chip, ride.riderOnTheWayAt && styles.chipActive]}>
                <Ionicons name={ride.riderOnTheWayAt ? 'walk' : 'checkmark'} size={16}
                  color={ride.riderOnTheWayAt ? colors.success : colors.textSecondary} />
                <Text style={[styles.chipText, ride.riderOnTheWayAt && styles.chipTextActive]}>
                  {ride.riderOnTheWayAt ? `${customer} ya salió y va al punto` : `Ya le avisamos a tu ${nouns.customer} que llegaste`}
                </Text>
              </View>
            </> : <>
              <Text style={styles.heroLabel}>{isDelivery ? 'Lleva la encomienda a' : `Lleva a ${customer} a`}</Text>
              <Text accessibilityRole="header" style={styles.heroTitle}>{ride.destination.name}</Text>
              {tripRoute && tripMinutes != null && <Text style={styles.heroStrong}>
                {tripMinutes} min · {formatKm(tripRoute.distanceMeters / 1000)} · llegada {formatClock(now + tripMinutes * 60_000)}
              </Text>}
            </>}
          </View>

          {ride.status !== 'arriving' && <DriverNavigationActions ride={ride} />}

          <View style={styles.passenger}>
            <PersonAvatar name={ride.rider.fullName} size={44} />
            <View style={styles.passengerInfo}>
              <Text style={styles.name}>{ride.rider.fullName}</Text>
              <Text style={styles.hint} numberOfLines={2}>
                {ride.status === 'arriving'
                  ? `Confirma su nombre antes de iniciar`
                  : `${nouns.customerTitle}${ride.rider.rating != null ? ` · ★ ${ride.rider.rating.toFixed(1)}` : ''}`}
              </Text>
            </View>
            <ContactIconButton icon="chatbubble-outline" label={`Enviar mensaje a ${customer}`} onSurface
              onPress={contact.message} disabled={!ride.rider.phone} />
            <ContactIconButton icon="call-outline" label={`Llamar a ${customer}`} onSurface
              onPress={contact.call} disabled={!ride.rider.phone} />
          </View>
          {contact.error && <Text accessibilityRole="alert" style={styles.error}>{contact.error}</Text>}

          {pickupPhase && <DriverSharingStatus rideId={ride.id} />}
          {travelling && <PaymentNote ride={ride} role="driver" />}
          {ride.status === 'accepted' && <RouteLine ride={ride} />}
        </ScrollView>
        <View style={styles.actions}>
          {actions.error && <Text accessibilityRole="alert" style={styles.error}>{actions.error}</Text>}
          {canAdvance && <SwipeToConfirm
            key={ride.status}
            label={advanceLabel(ride)}
            tone={ride.status === 'arriving' ? 'success' : 'primary'}
            loading={actions.busy}
            loadingLabel="Actualizando viaje…"
            onConfirm={() => actions.advance(ride.status)} />}
          {canCancel && <TripSecondaryAction title={isDelivery ? 'Cancelar entrega' : 'Cancelar viaje'}
            disabled={actions.busy}
            onPress={() => { if (!actions.busy) setConfirmation({ rideId: ride.id, status: ride.status }); }} />}
        </View>
      </SafeAreaView>

      <ConfirmDialog visible={!!currentConfirmation && !actions.busy}
        icon="warning-outline"
        destructive
        title={`¿Cancelar ${nouns.request}?`}
        message={`Tu ${nouns.customer} recibirá el aviso y el servicio ya no podrá continuar.`}
        confirmText="Sí, cancelar"
        cancelText="Volver al viaje"
        onConfirm={() => {
          if (!currentConfirmation) return;
          setConfirmation(null);
          actions.cancel(currentConfirmation.status);
        }}
        onCancel={() => setConfirmation(null)} />
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  ratingContent: { flexGrow: 1, padding: spacing.lg },
  resultContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '66%',
    backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: spacing.sm, shadowColor: '#000', shadowOpacity: 0.12,
    shadowRadius: 12, shadowOffset: { width: 0, height: -3 }, elevation: 12 },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: 'center' },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetContent: { padding: spacing.md, gap: spacing.sm + 4 },
  actions: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  hero: { gap: 2 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  waitText: { flex: 1, minWidth: 0, gap: 2 },
  waitBox: { alignItems: 'center', paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  waitValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  waitLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  heroLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.textSecondary },
  heroTitle: { fontSize: fontSize.xl + 4, fontWeight: fontWeight.bold, color: colors.text },
  heroStrong: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.xs,
    paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  chipActive: { backgroundColor: colors.successSoft },
  chipText: { fontSize: fontSize.sm, color: colors.textSecondary },
  chipTextActive: { color: colors.success, fontWeight: fontWeight.semibold },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary },
  passenger: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, padding: spacing.sm + 4,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.lg },
  passengerInfo: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  error: { fontSize: fontSize.sm, color: colors.danger },
});
