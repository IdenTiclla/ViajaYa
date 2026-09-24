import { useOfferComposer } from './useOfferComposer';
/**
 * Status of a sent offer (driver) — "Esperando al pasajero".
 *
 * Opens when **tapping** a request the driver already offered on. It shows,
 * in real time, the status of THAT offer:
 * - **Waiting**: the passenger is still reviewing; the offer's 30 s countdown.
 *   From here they can **improve** their proposal (replaces the previous one) or
 *   **withdraw** it entirely.
 * - **Accepted (won)**: the passenger decides — accepting your offer assigns you
 *   the ride directly and you jump to the ride in progress (via `driver-active-ride`).
 * - **Rejected / expired**: offers to make a new offer or improve the proposal.
 * - **Taken by someone else**: lost-ride notice.
 *
 * The offer data is read from the `useDriverRequests` store (not from params),
 * so the view is consistent wherever it is opened from.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/shared/components';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { useCountdown } from '@/core/hooks/useCountdown';
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useRoute } from '@/features/booking/application/useRoute';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { useNegotiationRide } from '@/features/driver/application/useNegotiationRide';
import { RideUnavailableScreen } from '@/features/driver/presentation/RideUnavailableScreen';
import { DriverTripInProgressScreen } from '@/features/driver/presentation/DriverTripInProgressScreen';
import {
  useWithdrawOffer,
} from '@/features/rides/application/useRideMutations';
import { useDriverActiveRide } from '@/features/rides/application/useRides';
import { formatKm, haversineKm } from '@/features/rides/domain/geo';
import { formatBolivianos, formatBolivianosInput } from '@/features/rides/domain/money';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min est.`;
}

export function OfferSentScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();

  const activeRideQuery = useDriverActiveRide();
  const { ride: activeRide } = activeRideQuery;


  // Live status of the offer (rejection over WebSocket; offer in the store).
  const rejectedRides = useDriverRequests((s) => s.rejected);
  const takenRides = useDriverRequests((s) => s.taken);
  const expiredRides = useDriverRequests((s) => s.expired);
  const pausedRides = useDriverRequests((s) => s.paused);
  const offeredMap = useDriverRequests((s) => s.offered);
  const beginOfferAttempt = useDriverRequests((s) => s.beginOfferAttempt);
  const markOffered = useDriverRequests((s) => s.markOffered);
  const markExpired = useDriverRequests((s) => s.markExpired);
  const markWithdrawn = useDriverRequests((s) => s.markWithdrawn);
  const wasRejected = !!rideId && rejectedRides.has(rideId);
  const wasTaken = !!rideId && takenRides.has(rideId);
  const isPaused = !!rideId && pausedRides.has(rideId);
  const sentOffer = rideId ? offeredMap[rideId] : undefined;

  const createOffer = useOfferComposer();
  const withdrawOffer = useWithdrawOffer();
  const sendingThisOffer = rideId != null && createOffer.pendingRideIds.has(rideId);
  const offerActionBusy = sendingThisOffer || withdrawOffer.isPending;
  const [showCounter, setShowCounter] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(440);
  const [headerHeight, setHeaderHeight] = useState(80);
  const [counterPrice, setCounterPrice] = useState('');

  // The request stays in the open list while nobody takes it.
  const openRidesQuery = useNegotiationRide(rideId, !activeRide);
  const { ride: openRide, isLoading } = openRidesQuery;

  const origin = openRide?.origin ?? null;
  const destination = openRide?.destination ?? null;
  const { route } = useRoute(origin, destination, openRide?.service ?? 'taxi');

  // The countdown is the driver's own offer's (30 s), display only.
  const secondsLeft = useCountdown(sentOffer?.expiresAt ?? null);
  // Single authority: the `expired` store (filled by the WS, or by an optimistic
  // markExpired if the countdown gets there first). This way this screen and the
  // map/list cards agree on when the offer expired.
  useEffect(() => {
    if (rideId && sentOffer?.expiresAt && secondsLeft === 0 && !expiredRides.has(rideId)) {
      markExpired(rideId, sentOffer.offerId);
    }
  }, [rideId, secondsLeft, sentOffer, expiredRides, markExpired]);
  const offerExpired = rideId != null && expiredRides.has(rideId);

  const originName = openRide?.origin.name ?? null;
  const destName = openRide?.destination.name ?? null;
  const offerPrice = sentOffer?.price ?? openRide?.fare ?? null;

  const backToList = () => router.replace('/(driver)/(tabs)/requests');

  // If the passenger renewed the request while the app was in the background,
  // the snapshot clears the previous offer's outcome. This screen is then
  // left without an active offer and must go back to the updated card, from
  // where the driver can send a new proposal at the current amount.
  useEffect(() => {
    if (
      rideId &&
      openRide &&
      !isLoading &&
      !sentOffer &&
      !wasRejected &&
      !offerExpired &&
      !wasTaken &&
      !isPaused
    ) {
      router.replace('/(driver)/(tabs)/requests');
    }
  }, [
    rideId,
    openRide,
    isLoading,
    sentOffer,
    wasRejected,
    offerExpired,
    wasTaken,
    isPaused,
    router,
  ]);

  const reAcceptAtFare = () => {
    if (!rideId || !openRide || offerActionBusy) return;
    const attemptToken = beginOfferAttempt(rideId);
    createOffer.mutate(
      { rideId, riderName: openRide.rider.fullName, poolVersion: openRide.poolVersion, pickup: openRide.origin.coordinates, service: openRide.service, input: { acceptAtFare: true } },
      {
        onSuccess: (offer) =>
          void markOffered(rideId, offer, openRide?.fare, attemptToken),
      },
    );
  };

  const openCounter = () => {
    if (offerActionBusy) return;
    createOffer.reset();
    setCounterPrice(formatBolivianosInput(offerPrice ?? openRide?.fare ?? 0));
    setShowCounter(true);
  };

  const parsedCounterPrice = Number(counterPrice.replace(',', '.'));
  const counterPriceIsValid = Number.isFinite(parsedCounterPrice) && parsedCounterPrice > 0;

  const submitCounter = () => {
    if (!rideId || !openRide || !counterPriceIsValid || offerActionBusy) return;
    setShowCounter(false);
    const attemptToken = beginOfferAttempt(rideId);
    createOffer.mutate(
      { rideId, riderName: openRide.rider.fullName, poolVersion: openRide.poolVersion, pickup: openRide.origin.coordinates, service: openRide.service, input: { acceptAtFare: false, price: parsedCounterPrice } },
      {
        onSuccess: (offer) => {
          void markOffered(rideId, offer, openRide?.fare, attemptToken);
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
              disabled={sendingThisOffer}
              accessibilityRole="button"
              accessibilityLabel="Cancelar mejora de oferta">
              <Text style={styles.priceModalCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.priceModalSubmit,
                (!counterPriceIsValid || sendingThisOffer) && styles.disabled,
              ]}
              onPress={submitCounter}
              disabled={!counterPriceIsValid || sendingThisOffer}
              accessibilityRole="button"
              accessibilityLabel="Enviar oferta mejorada">
              {sendingThisOffer ? (
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

  // Any assigned ride takes priority, even while viewing another negotiation.
  if (activeRide) {
    return <DriverTripInProgressScreen ride={activeRide} />;
  }

  if (
    !openRide &&
    !activeRideQuery.isError &&
    !openRidesQuery.isError &&
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

  // Another driver got the ride (confirmed it first): lost ride.
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

  // The passenger is modifying the request (Modify): the offer was withdrawn
  // temporarily. It is not a lost ride — when the edit ends, the driver
  // can offer again from the list. (Without this guard, the screen fell into
  // the "Viaje ya no disponible" state.)
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

  // The request is no longer open and is not mine: another driver took it or it was cancelled.
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

  // Rejected or expired, but the request is still open: offer to re-offer.
  if (wasRejected || offerExpired) {
    return (
      <>
        <ReofferScreen
          rejected={wasRejected}
          price={offerPrice}
          fare={openRide?.fare ?? null}
          originName={originName}
          destName={destName}
          submitting={sendingThisOffer}
          errorMessage={createOffer.isError ? getApiErrorMessage(createOffer.error) : null}
          onReoffer={reAcceptAtFare}
          onImprove={openCounter}
          onBack={backToList}
        />
        {counterPriceInput}
        {createOffer.offerFeedback}
      </>
    );
  }

  const withdraw = () => {
    if (offerActionBusy) return;
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
                  if (rideId) markWithdrawn(rideId, sentOffer.offerId);
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
        <TripRouteMap service={openRide?.service ?? 'taxi'} origin={origin} destination={destination} topPadding={headerHeight} bottomPadding={sheetHeight} />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none"
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
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

      <SafeAreaView edges={['bottom']} style={styles.sheet}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <ScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          bounces={false}>
        <View style={styles.sheetHandle} />

        <View style={styles.statusHeader}>
          <SpinnerRing />
          <Text style={styles.statusTitle}>Esperando al pasajero</Text>
          <Text style={styles.statusHint}>Tu oferta sigue activa mientras negocias con otros pasajeros.</Text>
          <Button title="Seguir viendo solicitudes" variant="secondary" leadingIcon="list"
            onPress={backToList} />
          <Text style={styles.statusHint}>El primero que acepte confirma tu viaje. Tus otras ofertas se retiran automáticamente.</Text>
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
                <Text style={styles.routeLabel}>Origen:</Text>
                <Text style={styles.routeValue} numberOfLines={1}>
                  {openRide?.origin.name ?? '—'}
                </Text>
              </View>
              <View>
                <Text style={styles.routeLabel}>Destino:</Text>
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

        {createOffer.offerFeedback}
        <View style={styles.actions}>
          <Button
            title="Mejorar oferta"
            variant="secondary"
            leadingIcon="trending-up"
            loading={sendingThisOffer}
            loadingLabel="Enviando…"
            onPress={openCounter}
            disabled={offerActionBusy}
          />
          <Button
            title="Retirar propuesta"
            variant="dangerSoft"
            leadingIcon="close"
            loading={withdrawOffer.isPending}
            loadingLabel="Retirando…"
            onPress={withdraw}
            disabled={offerActionBusy}
          />
          <Text style={styles.actionsHint}>
            Mejorar tu oferta reemplaza la anterior. Al retirarla, otros conductores podrían
            tomar el viaje.
          </Text>
        </View>
        </ScrollView>
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
  const { colors, styles } = useThemedStyles(createStyles);
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
  const { colors, styles } = useThemedStyles(createStyles);
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

/** Loading ring that spins (indeterminate) around a clock icon. */
function SpinnerRing() {
  const { colors, styles } = useThemedStyles(createStyles);
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

const createStyles = ({ colors }: Theme) => StyleSheet.create({
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
    height: '64%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetContent: { padding: spacing.lg, gap: spacing.lg },
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
    backgroundColor: colors.dangerSoft,
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
