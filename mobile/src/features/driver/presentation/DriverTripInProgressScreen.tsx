/** Driver pickup, travel and closing, with explicit confirmations for each ride. */
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useRoute } from '@/features/booking/application/useRoute';
import { useTripActions, useTripContact } from '@/features/rides/application/useTripActions';
import { DRIVER_ACTIVE_RIDE_KEY } from '@/features/rides/application/useRides';
import { serviceNouns } from '@/features/rides/domain/serviceNouns';
import type { Ride, RideStatus } from '@/features/rides/domain/types';
import { RideRatingCard } from '@/features/rides/presentation/RideRatingCard';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { TripProgress } from '@/features/rides/presentation/TripProgress';
import { TripSummary } from '@/features/rides/presentation/TripSummary';
import { TripSecondaryAction } from '@/features/rides/presentation/TripSecondaryAction';
import { Button, ConfirmDialog, FeedbackState } from '@/shared/components';

import { DriverNavigationActions } from '@/features/navigation/presentation/DriverNavigationActions';
import { DriverSharingStatus } from '@/features/tracking/presentation/DriverSharingStatus';
import { useLocationSharingStore } from '@/features/tracking/application/locationSharingStore';

type Confirmation = { rideId: string; status: RideStatus; action: 'arrive' | 'start' | 'complete' | 'cancel' };

function getStage(ride: Ride) {
  const nouns = serviceNouns(ride.service);
  if (ride.status === 'accepted') return {
    title: 'Ve al punto de recogida',
    hint: [ride.origin.name, ride.origin.address !== ride.origin.name && ride.origin.address].filter(Boolean).join(' · '),
    action: 'Ya llegué al punto',
  };
  if (ride.status === 'arriving') return {
    title: ride.riderOnTheWayAt ? 'Tu pasajero va al punto' : 'Llegada avisada',
    hint: ride.riderOnTheWayAt
      ? `${ride.rider.fullName} avisó que ya salió. Inicia solo cuando esté a bordo.`
      : `Le avisamos a tu ${nouns.customer}. Inicia cuando esté contigo.`,
    action: ride.service === 'delivery' ? 'Iniciar entrega' : ride.service === 'moving' ? 'Iniciar mudanza' : 'Iniciar viaje',
  };
  return {
    title: ride.service === 'delivery' ? 'Encomienda en camino' : 'Viaje en curso',
    hint: [ride.destination.name, ride.destination.address !== ride.destination.name && ride.destination.address].filter(Boolean).join(' · '),
    action: ride.service === 'delivery' ? 'Confirmar entrega' : 'Finalizar viaje',
  };
}

export function DriverTripInProgressScreen({ ride }: { ride: Ride }) {
  const { styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const sharing = useLocationSharingStore();
  const actions = useTripActions(ride);
  const contact = useTripContact(ride, ride.rider.phone);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [sheetHeight, setSheetHeight] = useState(440);
  const terminal = ride.status === 'completed' || ride.status === 'cancelled';
  const { route } = useRoute(terminal ? null : ride.origin, terminal ? null : ride.destination, ride.service);
  const nouns = serviceNouns(ride.service);

  const close = async (rated = false) => {
    // Rating mutations already reconcile both caches before invoking onDone.
    if (!rated) {
      await queryClient.cancelQueries({ queryKey: DRIVER_ACTIVE_RIDE_KEY }, { revert: false });
      queryClient.setQueryData<Ride | null>(DRIVER_ACTIVE_RIDE_KEY,
        (current) => current?.id === ride.id ? null : current);
    }
    router.replace('/(driver)/(tabs)/solicitudes');
  };
  const requestConfirmation = (action: Confirmation['action']) => {
    if (!actions.busy) setConfirmation({ rideId: ride.id, status: ride.status, action });
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

  const stage = getStage(ride);
  const canCancel = ride.status === 'accepted' || ride.status === 'arriving';
  const canAdvance = canCancel || ride.status === 'in_progress';
  const isDelivery = ride.service === 'delivery';

  return (
    <View style={styles.root}>
      <TripRouteMap vehicle={sharing.rideId === ride.id && sharing.coordinates ? { coordinates: sharing.coordinates, heading: sharing.heading, type: ride.driver?.vehicleType ?? null } : undefined} service={ride.service} origin={ride.origin} destination={ride.destination} topPadding={48} bottomPadding={sheetHeight} />
      <SafeAreaView style={styles.sheet} edges={['bottom']} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <View style={styles.handle} />
        <ScrollView contentContainerStyle={styles.sheetContent} bounces={false}>
          <TripProgress status={ride.status} />
          <View style={styles.stage} accessibilityLiveRegion="polite">
            <Text accessibilityRole="header" style={styles.stageTitle}>{stage.title}</Text>
            <Text style={styles.hint}>{stage.hint}</Text>
          </View>

          <DriverNavigationActions ride={ride} />
          <DriverSharingStatus rideId={ride.id} />
          <View style={styles.passenger}>
            <Text style={styles.name}>{ride.rider.fullName}</Text>
            <Text style={styles.hint}>{nouns.customerTitle}{ride.rider.rating != null ? ` · ${ride.rider.rating.toFixed(1)} de 5` : ''}</Text>
            {ride.rider.phone ? (
              <View style={styles.contacts}>
                <Button title="Llamar" leadingIcon="call-outline" variant="secondary" onPress={contact.call} style={styles.contactButton} />
                <Button title="Mensaje" leadingIcon="chatbubble-outline" variant="secondary" onPress={contact.message} style={styles.contactButton} />
              </View>
            ) : <Text style={styles.hint}>No hay un teléfono de contacto disponible.</Text>}
            {contact.error && <Text accessibilityRole="alert" style={styles.error}>{contact.error}</Text>}
          </View>

          <TripSummary key={ride.id} ride={ride} compact showCurrentPlace={false} />
          {route && <Text style={styles.hint}>
            Trayecto estimado de recogida a destino: {(route.distanceMeters / 1000).toFixed(1)} km · {Math.max(1, Math.round(route.durationSeconds / 60))} min.
          </Text>}
        </ScrollView>
        <View style={styles.actions}>
          {actions.error && <Text accessibilityRole="alert" style={styles.error}>{actions.error}</Text>}
          {canAdvance && <Button title={stage.action} leadingIcon="checkmark-circle-outline" loading={actions.busy}
            loadingLabel="Actualizando viaje…" onPress={() => {
              if (ride.status === 'accepted') requestConfirmation('arrive');
              else requestConfirmation(ride.status === 'arriving' ? 'start' : 'complete');
            }} />}
          {canCancel && <TripSecondaryAction title={isDelivery ? 'Cancelar entrega' : 'Cancelar viaje'}
            disabled={actions.busy} onPress={() => requestConfirmation('cancel')} />}
        </View>
      </SafeAreaView>

      <ConfirmDialog visible={!!currentConfirmation && !actions.busy}
        icon={currentConfirmation?.action === 'cancel' ? 'warning-outline' : 'checkmark-circle-outline'}
        destructive={currentConfirmation?.action === 'cancel'}
        title={currentConfirmation?.action === 'cancel' ? `¿Cancelar ${nouns.request}?`
          : currentConfirmation?.action === 'arrive' ? '¿Llegaste al punto de recogida?'
          : currentConfirmation?.action === 'start' ? `¿Iniciar ${nouns.request}?` : `¿Finalizar ${nouns.request}?`}
        message={currentConfirmation?.action === 'cancel'
          ? `Tu ${nouns.customer} recibirá el aviso y el servicio ya no podrá continuar.`
          : currentConfirmation?.action === 'arrive'
            ? `Confirma que estás en ${ride.origin.name}. Tu ${nouns.customer} recibirá el aviso de llegada.`
          : currentConfirmation?.action === 'start'
            ? isDelivery ? 'Confirma que recibiste la encomienda correcta y estás listo para llevarla al destino.'
              : ride.service === 'moving' ? 'Confirma con el cliente que la carga está lista para salir.'
                : `Confirma que ${ride.rider.fullName} es tu pasajero y ya está contigo para iniciar el viaje.`
            : 'Confirma que llegaste al destino acordado. Finalizar el servicio no confirma ni procesa su pago.'}
        confirmText={currentConfirmation?.action === 'cancel' ? 'Sí, cancelar'
          : currentConfirmation?.action === 'arrive' ? 'Sí, ya llegué'
          : currentConfirmation?.action === 'start' ? 'Sí, iniciar' : 'Sí, finalizar'}
        cancelText="Volver al viaje"
        onConfirm={() => {
          if (!currentConfirmation) return;
          setConfirmation(null);
          if (currentConfirmation.action === 'cancel') actions.cancel(currentConfirmation.status);
          else actions.advance(currentConfirmation.status);
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
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '64%',
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm, shadowColor: '#000', shadowOpacity: 0.12,
    shadowRadius: 12, shadowOffset: { width: 0, height: -3 }, elevation: 12 },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: 'center' },
  sheetContent: { padding: spacing.md, gap: spacing.sm },
  actions: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  stage: { padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.primarySoft, borderRadius: radius.md },
  stageTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.primary },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  passenger: { gap: spacing.xs, padding: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
  label: { fontSize: fontSize.sm, color: colors.textSecondary },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  contacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  contactButton: { flexGrow: 1 },
  error: { fontSize: fontSize.sm, color: colors.danger },
});
