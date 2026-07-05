/**
 * Estado de una oferta enviada (conductor) — "Esperando al pasajero".
 *
 * Se abre al **tocar** una solicitud en la que el conductor ya ofertó. Muestra,
 * en tiempo real, el estado de ESA oferta:
 * - **Esperando**: el pasajero aún revisa; contador de 30 s de la oferta.
 *   Desde aquí puede **mejorar** su propuesta (reemplaza la anterior) o
 *   **retirarla** del todo.
 * - **Aceptada (ganó)**: el pasajero decide —al aceptar tu oferta el viaje se te
 *   asigna directo y saltas al viaje en curso (vía `driver-active-ride`).
 * - **Rechazada / expirada**: ofrece volver a ofertar o mejorar la propuesta.
 * - **Tomada por otro**: aviso de viaje perdido.
 *
 * Los datos de la oferta se leen del store `useDriverRequests` (no de params),
 * así la vista es consistente venga de donde venga.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { useCountdown } from '@/core/hooks/useCountdown';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useRoute } from '@/features/booking/application/useRoute';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { RideUnavailableScreen } from '@/features/driver/presentation/RideUnavailableScreen';
import { ViajeEnCursoConductorScreen } from '@/features/driver/presentation/ViajeEnCursoConductorScreen';
import {
  useCreateOffer,
  useWithdrawOffer,
} from '@/features/rides/application/useRideMutations';
import { useDriverActiveRide, useOpenRides } from '@/features/rides/application/useRides';
import { formatKm, haversineKm } from '@/features/rides/domain/geo';
import { FareKeypad } from '@/features/rides/presentation/FareKeypad';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min est.`;
}

export function OfertaEnviadaScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();

  const { ride: activeRide } = useDriverActiveRide();
  const won = !!activeRide && activeRide.id === rideId;

  // Estado en vivo de la oferta (rechazo por WebSocket; oferta en store).
  const rejectedRides = useDriverRequests((s) => s.rejected);
  const takenRides = useDriverRequests((s) => s.taken);
  const expiredRides = useDriverRequests((s) => s.expired);
  const offeredMap = useDriverRequests((s) => s.offered);
  const markOffered = useDriverRequests((s) => s.markOffered);
  const markExpired = useDriverRequests((s) => s.markExpired);
  const clearRide = useDriverRequests((s) => s.clearRide);
  const wasRejected = !!rideId && rejectedRides.has(rideId);
  const wasTaken = !!rideId && takenRides.has(rideId);
  const sentOffer = rideId ? offeredMap[rideId] : undefined;

  const createOffer = useCreateOffer();
  const withdrawOffer = useWithdrawOffer();
  const [showCounter, setShowCounter] = useState(false);

  // La solicitud sigue en la lista abierta mientras nadie la toma.
  const { rides, isLoading } = useOpenRides(!won);
  const openRide = rides.find((r) => r.id === rideId) ?? null;

  const origin = openRide?.origin ?? null;
  const destination = openRide?.destination ?? null;
  const { route } = useRoute(origin, destination);

  // El contador es el de la propia oferta del conductor (30 s), solo para display.
  const secondsLeft = useCountdown(sentOffer?.expiresAt ?? null);
  // Autoridad única: el store `expired` (poblado por el WS, o por markExpired
  // optimista si el countdown llega antes). Así esta pantalla y las cards del
  // mapa/lista coinciden en cuándo la oferta venció.
  useEffect(() => {
    if (rideId && sentOffer?.expiresAt && secondsLeft === 0 && !expiredRides.has(rideId)) {
      markExpired(rideId);
    }
  }, [rideId, secondsLeft, sentOffer, expiredRides, markExpired]);
  const offerExpired = rideId != null && expiredRides.has(rideId);

  const originName = openRide?.origin.name ?? null;
  const destName = openRide?.destination.name ?? null;
  const offerPrice = sentOffer?.price ?? openRide?.fare ?? null;

  const backToList = () => router.replace('/(driver)/(tabs)/solicitudes');

  const reAcceptAtFare = () => {
    if (!rideId || createOffer.isPending) return;
    createOffer.mutate(
      { rideId, input: { acceptAtFare: true } },
      { onSuccess: (offer) => markOffered(rideId, offer) },
    );
  };

  const submitCounter = (price: number) => {
    if (!rideId) return;
    createOffer.mutate(
      { rideId, input: { acceptAtFare: false, price } },
      {
        onSuccess: (offer) => {
          markOffered(rideId, offer);
          setShowCounter(false);
        },
      },
    );
  };

  // Si confirmé mi oferta y gané la carrera, muestro el viaje en curso aquí mismo.
  if (won && activeRide) {
    return <ViajeEnCursoConductorScreen ride={activeRide} />;
  }

  // Otro conductor se llevó el viaje (lo confirmó primero): viaje perdido.
  if (wasTaken) {
    return (
      <RideUnavailableScreen
        price={offerPrice}
        originName={originName}
        destName={destName}
        onBack={backToList}
        title="Otro conductor tomó el viaje"
        hint="Esta vez se adelantaron. ¡No te desanimes! Hay más solicitudes esperándote en el mapa."
      />
    );
  }

  // La solicitud ya no está abierta y no es mía: otro conductor la tomó o se canceló.
  if (!isLoading && !openRide) {
    return (
      <RideUnavailableScreen
        price={offerPrice}
        originName={originName}
        destName={destName}
        onBack={backToList}
      />
    );
  }

  // Rechazada o expirada, pero la solicitud sigue abierta: ofrecer re-ofertar.
  if (wasRejected || offerExpired) {
    return (
      <>
        <ReofferScreen
          rejected={wasRejected}
          price={offerPrice}
          fare={openRide?.fare ?? null}
          originName={originName}
          destName={destName}
          submitting={createOffer.isPending}
          errorMessage={createOffer.isError ? getApiErrorMessage(createOffer.error) : null}
          onReoffer={reAcceptAtFare}
          onImprove={() => setShowCounter(true)}
          onBack={backToList}
        />
        <FareKeypad
          visible={showCounter}
          mode="absolute"
          subtitle={`El pasajero ofrece Bs ${(openRide?.fare ?? 0).toFixed(2)}`}
          submitting={createOffer.isPending}
          onCancel={() => setShowCounter(false)}
          onSubmit={submitCounter}
        />
      </>
    );
  }

  const retirar = () => {
    Alert.alert(
      'Retirar propuesta',
      'Al retirar tu oferta, otros conductores podrían tomar el viaje.',
      [
        { text: 'Seguir esperando', style: 'cancel' },
        {
          text: 'Retirar',
          style: 'destructive',
          onPress: () => {
            if (sentOffer) {
              withdrawOffer.mutate(sentOffer.offerId, {
                onSettled: () => {
                  if (rideId) clearRide(rideId);
                  backToList();
                },
              });
            } else {
              backToList();
            }
          },
        },
      ],
    );
  };

  const tripKm = openRide ? haversineKm(openRide.origin.coordinates, openRide.destination.coordinates) : null;

  return (
    <View style={styles.root}>
      {origin && destination ? (
        <TripRouteMap origin={origin} destination={destination} bottomPadding={440} />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={backToList}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Oferta enviada</Text>
        <View style={styles.iconBtn} />
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.sheetHandle} />

        <View style={styles.statusHeader}>
          <SpinnerRing />
          <Text style={styles.statusTitle}>Esperando al pasajero</Text>
          <Text style={styles.statusHint}>El pasajero está revisando tu propuesta…</Text>
          <OfferLifeTimer secondsLeft={secondsLeft} />
        </View>

        <View style={styles.infoCard}>
          <View style={styles.offerRow}>
            <Text style={styles.offerLabel}>Tu oferta</Text>
            <Text style={styles.offerPrice}>
              {offerPrice != null ? `Bs ${offerPrice.toFixed(2)}` : '—'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.routeRow}>
            <View style={styles.routeTrack}>
              <View style={styles.dotOrigin} />
              <View style={styles.trackLine} />
              <Ionicons name="location" size={18} color={colors.danger} />
            </View>
            <View style={styles.routeText}>
              <View>
                <Text style={styles.routeLabel}>Punto de encuentro</Text>
                <Text style={styles.routeValue} numberOfLines={1}>
                  {openRide?.origin.name ?? '—'}
                </Text>
              </View>
              <View>
                <Text style={styles.routeLabel}>Destino</Text>
                <Text style={styles.routeValue} numberOfLines={1}>
                  {openRide?.destination.name ?? '—'}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.meta}>
              <Ionicons name="navigate" size={18} color={colors.textSecondary} />
              <Text style={styles.metaText}>{tripKm != null ? formatKm(tripKm) : '—'}</Text>
            </View>
            <View style={styles.meta}>
              <Ionicons name="time" size={18} color={colors.textSecondary} />
              <Text style={styles.metaText}>
                {route
                  ? formatDuration(route.durationSeconds)
                  : sentOffer?.etaMin != null
                    ? `${sentOffer.etaMin} min est.`
                    : '—'}
              </Text>
            </View>
          </View>
        </View>

        {createOffer.isError && (
          <Text style={styles.inlineError}>{getApiErrorMessage(createOffer.error)}</Text>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.mejorar, createOffer.isPending && styles.disabled]}
            onPress={() => setShowCounter(true)}
            disabled={createOffer.isPending}
            accessibilityRole="button"
            accessibilityLabel="Mejorar oferta">
            <Ionicons name="trending-up" size={20} color={colors.primary} />
            <Text style={styles.mejorarText}>Mejorar oferta</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.retirar, withdrawOffer.isPending && styles.disabled]}
            onPress={retirar}
            disabled={withdrawOffer.isPending}
            accessibilityRole="button"
            accessibilityLabel="Retirar propuesta">
            <Ionicons name="close" size={20} color={colors.danger} />
            <Text style={styles.retirarText}>Retirar propuesta</Text>
          </TouchableOpacity>
          <Text style={styles.actionsHint}>
            Mejorar tu oferta reemplaza la anterior. Al retirarla, otros conductores podrían
            tomar el viaje.
          </Text>
        </View>
      </SafeAreaView>

      <FareKeypad
        visible={showCounter}
        mode="absolute"
        subtitle={`El pasajero ofrece Bs ${(openRide?.fare ?? 0).toFixed(2)}`}
        submitting={createOffer.isPending}
        onCancel={() => setShowCounter(false)}
        onSubmit={submitCounter}
      />
    </View>
  );
}

/** Estado "puedes volver a ofertar" (rechazada o expirada), en vivo. */
function ReofferScreen({
  rejected,
  price,
  fare,
  originName,
  destName,
  submitting,
  errorMessage,
  onReoffer,
  onImprove,
  onBack,
}: {
  rejected: boolean;
  price: number | null;
  fare: number | null;
  originName: string | null;
  destName: string | null;
  submitting: boolean;
  errorMessage: string | null;
  onReoffer: () => void;
  onImprove: () => void;
  onBack: () => void;
}) {
  return (
    <SafeAreaView style={styles.reofferRoot}>
      <View style={styles.reofferIcon}>
        <Ionicons
          name={rejected ? 'close-circle' : 'timer-outline'}
          size={48}
          color={colors.danger}
        />
      </View>
      <Text style={styles.reofferTitle}>
        {rejected ? 'El pasajero rechazó tu oferta' : 'Tu oferta expiró'}
      </Text>
      <Text style={styles.reofferHint}>
        {rejected
          ? 'Puedes mejorar tu propuesta o volver a enviarla. La solicitud sigue activa.'
          : 'Pasaron 30 segundos sin respuesta. Vuelve a ofertar o mejora tu propuesta.'}
      </Text>

      {(price != null || originName || destName) && (
        <View style={styles.reofferSummary}>
          {price != null && <Text style={styles.reofferSummaryPrice}>Tu oferta: Bs {price.toFixed(2)}</Text>}
          {(originName || destName) && (
            <Text style={styles.reofferSummaryRoute} numberOfLines={1}>
              {originName ?? '—'} → {destName ?? '—'}
            </Text>
          )}
        </View>
      )}

      {errorMessage && <Text style={styles.reofferError}>{errorMessage}</Text>}

      <View style={styles.reofferActions}>
        <TouchableOpacity
          style={[styles.reofferPrimary, submitting && styles.disabled]}
          onPress={onReoffer}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={fare != null ? `Ofertar de nuevo por Bs ${fare.toFixed(2)}` : 'Ofertar de nuevo'}>
          <Ionicons name="send" size={18} color={colors.textOnPrimary} />
          <Text style={styles.reofferPrimaryText}>
            {fare != null ? `Ofertar de nuevo (Bs ${fare.toFixed(2)})` : 'Ofertar de nuevo'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.reofferSecondary, submitting && styles.disabled]}
          onPress={onImprove}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Mejorar oferta">
          <Text style={styles.reofferSecondaryText}>Mejorar oferta</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.reofferGhost}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Volver a solicitudes">
          <Text style={styles.reofferGhostText}>Volver a solicitudes</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/** Anillo de carga que gira (indeterminado) alrededor de un ícono de reloj. */
function SpinnerRing() {
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.spinnerWrap}>
      <Animated.View style={[styles.spinnerRing, { transform: [{ rotate }] }]} />
      <Ionicons name="time-outline" size={30} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceMuted },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
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
  topTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.lg,
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

  statusHeader: { alignItems: 'center', gap: spacing.xs },
  spinnerWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  spinnerRing: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.primary,
    borderTopColor: 'transparent',
  },
  statusTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  statusHint: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },

  infoCard: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  offerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  offerLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  offerPrice: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  divider: { height: 1, backgroundColor: colors.border },

  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeTrack: { alignItems: 'center', paddingVertical: 2 },
  dotOrigin: { width: 12, height: 12, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.primary },
  trackLine: { width: 2, flex: 1, minHeight: 24, backgroundColor: colors.border, marginVertical: 4 },
  routeText: { flex: 1, gap: spacing.md },
  routeLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  routeValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },

  metaRow: { flexDirection: 'row', gap: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaText: { fontSize: fontSize.md, color: colors.text },

  actions: { gap: spacing.sm },
  mejorar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  mejorarText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  retirar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: '#FDECEA',
  },
  retirarText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.danger },
  actionsHint: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.md },
  disabled: { opacity: 0.5 },
  inlineError: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },

  reofferRoot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  reofferIcon: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reofferTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  reofferHint: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
  reofferSummary: {
    alignSelf: 'stretch',
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  reofferSummaryPrice: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.primary },
  reofferSummaryRoute: { fontSize: fontSize.sm, color: colors.textSecondary },
  reofferError: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  reofferActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  reofferPrimary: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reofferPrimaryText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  reofferSecondary: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reofferSecondaryText: { color: colors.primary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  reofferGhost: { height: 44, alignItems: 'center', justifyContent: 'center' },
  reofferGhostText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
