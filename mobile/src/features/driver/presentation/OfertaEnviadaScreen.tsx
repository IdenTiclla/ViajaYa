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
import {
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
import { formatBolivianos, formatBolivianosInput } from '@/features/rides/domain/money';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min est.`;
}

export function OfertaEnviadaScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();

  const activeRideQuery = useDriverActiveRide();
  const { ride: activeRide } = activeRideQuery;
  const won = !!activeRide && activeRide.id === rideId;

  // Estado en vivo de la oferta (rechazo por WebSocket; oferta en store).
  const rejectedRides = useDriverRequests((s) => s.rejected);
  const takenRides = useDriverRequests((s) => s.taken);
  const expiredRides = useDriverRequests((s) => s.expired);
  const pausedRides = useDriverRequests((s) => s.paused);
  const offeredMap = useDriverRequests((s) => s.offered);
  const markOffered = useDriverRequests((s) => s.markOffered);
  const markExpired = useDriverRequests((s) => s.markExpired);
  const clearRide = useDriverRequests((s) => s.clearRide);
  const wasRejected = !!rideId && rejectedRides.has(rideId);
  const wasTaken = !!rideId && takenRides.has(rideId);
  const isPaused = !!rideId && pausedRides.has(rideId);
  const sentOffer = rideId ? offeredMap[rideId] : undefined;

  const createOffer = useCreateOffer();
  const withdrawOffer = useWithdrawOffer();
  const [showCounter, setShowCounter] = useState(false);
  const [counterPrice, setCounterPrice] = useState('');

  // La solicitud sigue en la lista abierta mientras nadie la toma.
  const openRidesQuery = useOpenRides(!won);
  const { rides, isLoading } = openRidesQuery;
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

  const openCounter = () => {
    createOffer.reset();
    setCounterPrice(formatBolivianosInput(offerPrice ?? openRide?.fare ?? 0));
    setShowCounter(true);
  };

  const parsedCounterPrice = Number(counterPrice.replace(',', '.'));
  const counterPriceIsValid = Number.isFinite(parsedCounterPrice) && parsedCounterPrice > 0;

  const submitCounter = () => {
    if (!rideId || !counterPriceIsValid || createOffer.isPending) return;
    createOffer.mutate(
      { rideId, input: { acceptAtFare: false, price: parsedCounterPrice } },
      {
        onSuccess: (offer) => {
          markOffered(rideId, offer);
          setShowCounter(false);
        },
      },
    );
  };

  const counterPriceInput = (
    <Modal
      visible={showCounter}
      transparent
      animationType="fade"
      onRequestClose={() => setShowCounter(false)}>
      <KeyboardAvoidingView
        style={styles.priceModalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.priceModal}>
          <Text style={styles.priceModalTitle}>Mejorar oferta</Text>
          <Text style={styles.priceModalHint}>
            El pasajero ofrece Bs {formatBolivianos(openRide?.fare ?? 0)}
          </Text>
          <View style={styles.priceInputRow}>
            <Text style={styles.priceCurrency}>Bs</Text>
            <TextInput
              autoFocus
              value={counterPrice}
              onChangeText={setCounterPrice}
              selectTextOnFocus
              placeholder="30"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={9}
              style={styles.priceInput}
              accessibilityLabel="Monto de la nueva oferta en bolivianos"
              onSubmitEditing={submitCounter}
            />
          </View>
          {createOffer.isError && (
            <Text style={styles.priceModalError}>{getApiErrorMessage(createOffer.error)}</Text>
          )}
          <View style={styles.priceModalActions}>
            <TouchableOpacity
              style={styles.priceModalCancel}
              onPress={() => setShowCounter(false)}
              disabled={createOffer.isPending}
              accessibilityRole="button"
              accessibilityLabel="Cancelar mejora de oferta">
              <Text style={styles.priceModalCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.priceModalSubmit,
                (!counterPriceIsValid || createOffer.isPending) && styles.disabled,
              ]}
              onPress={submitCounter}
              disabled={!counterPriceIsValid || createOffer.isPending}
              accessibilityRole="button"
              accessibilityLabel="Enviar oferta mejorada">
              {createOffer.isPending ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.priceModalSubmitText}>Enviar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  // Si confirmé mi oferta y gané la carrera, muestro el viaje en curso aquí mismo.
  if (won && activeRide) {
    return <ViajeEnCursoConductorScreen ride={activeRide} />;
  }

  if (
    !sentOffer &&
    !openRide &&
    (activeRideQuery.isLoading || openRidesQuery.isLoading)
  ) {
    return <OfferRecoveryScreen onBack={backToList} />;
  }

  if (
    !openRide &&
    (activeRideQuery.isError || openRidesQuery.isError)
  ) {
    return (
      <OfferRecoveryScreen
        error={getApiErrorMessage(
          activeRideQuery.isError ? activeRideQuery.error : openRidesQuery.error,
        )}
        onBack={backToList}
        onRetry={() => {
          void activeRideQuery.refetch();
          void openRidesQuery.refetch();
        }}
      />
    );
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

  // El pasajero está modificando la solicitud (Modificar): la oferta fue retirada
  // temporalmente. No es un viaje perdido — al terminar la edición, el conductor
  // podrá ofertar de nuevo desde la lista. (Sin este guard, la pantalla caía en
  // el estado "Viaje ya no disponible".)
  if (isPaused) {
    return (
      <RideUnavailableScreen
        price={offerPrice}
        originName={originName}
        destName={destName}
        onBack={backToList}
        priceLabel="Tu oferta"
        title="El pasajero está modificando su solicitud"
        hint="Tu oferta se retiró mientras el pasajero edita los detalles. Cuando termine, la solicitud volverá a la lista y podrás ofertar de nuevo."
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
          onImprove={openCounter}
          onBack={backToList}
        />
        {counterPriceInput}
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
                onSuccess: () => {
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
              {offerPrice != null ? `Bs ${formatBolivianos(offerPrice)}` : '—'}
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

        {(createOffer.isError || withdrawOffer.isError) && (
          <Text style={styles.inlineError}>
            {getApiErrorMessage(
              createOffer.isError ? createOffer.error : withdrawOffer.error,
            )}
          </Text>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.mejorar, createOffer.isPending && styles.disabled]}
            onPress={openCounter}
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

      {counterPriceInput}
    </View>
  );
}

function OfferRecoveryScreen({
  error,
  onBack,
  onRetry,
}: {
  error?: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  return (
    <SafeAreaView style={styles.recoveryRoot}>
      <View style={styles.recoveryTop}>
        <TouchableOpacity
          style={styles.recoveryBack}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Volver a solicitudes">
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <View style={styles.recoveryBody}>
        {error ? (
          <Ionicons name="cloud-offline-outline" size={46} color={colors.textSecondary} />
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
        <Text style={styles.recoveryTitle}>
          {error ? 'No pudimos verificar tu oferta' : 'Recuperando tu oferta…'}
        </Text>
        {error && <Text style={styles.recoveryHint}>{error}</Text>}
        {onRetry && (
          <TouchableOpacity
            style={styles.recoveryRetry}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Reintentar actualización de la oferta">
            <Ionicons name="refresh" size={19} color={colors.textOnPrimary} />
            <Text style={styles.recoveryRetryText}>Reintentar</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
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
          {price != null && <Text style={styles.reofferSummaryPrice}>Tu oferta: Bs {formatBolivianos(price)}</Text>}
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
          accessibilityLabel={fare != null ? `Ofertar de nuevo por Bs ${formatBolivianos(fare)}` : 'Ofertar de nuevo'}>
          <Ionicons name="send" size={18} color={colors.textOnPrimary} />
          <Text style={styles.reofferPrimaryText}>
            {fare != null ? `Ofertar de nuevo (Bs ${formatBolivianos(fare)})` : 'Ofertar de nuevo'}
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
  recoveryRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  recoveryTop: {
    minHeight: 60,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  recoveryBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  recoveryBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  recoveryTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  recoveryHint: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  recoveryRetry: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  recoveryRetryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textOnPrimary,
  },
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
  priceModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  priceModal: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface },
  priceModalTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  priceModalHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 54,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  priceCurrency: { marginRight: spacing.sm, color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  priceInput: { flex: 1, padding: 0, color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  priceModalError: { color: colors.danger, fontSize: fontSize.sm },
  priceModalActions: { flexDirection: 'row', gap: spacing.sm },
  priceModalCancel: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  priceModalCancelText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  priceModalSubmit: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  priceModalSubmitText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },

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
