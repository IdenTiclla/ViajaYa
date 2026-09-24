import { useOfferComposer } from './useOfferComposer';
/**
 * Incoming requests (driver) — Material You design.
 *
 * Three states: active ride → tracking; no requests → map with radar and
 * a compact status; with requests → glass header
 * + List/Map toggle and translucent cards. The driver **offers** (does not
 * assign): Enviar oferta leaves the card on "Oferta enviada" and they keep seeing others.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { DriverSearchMap } from '@/features/driver/presentation/DriverSearchMap';
import { OfferSentOverlay } from '@/features/driver/presentation/OfferSentOverlay';
import { RequestCard } from '@/features/driver/presentation/RequestCard';
import { RequestsMap } from '@/features/driver/presentation/SolicitudesMapa';
import { DriverTripInProgressScreen } from '@/features/driver/presentation/ViajeEnCursoConductorScreen';
import { useWatchPosition, type WatchedPosition } from '@/features/home/application/useWatchPosition';
import {
  useDismissOpenRide,
  useSetOnline,
  useWithdrawOffer,
} from '@/features/rides/application/useRideMutations';
import { formatBolivianos, formatBolivianosInput } from '@/features/rides/domain/money';
import {
  useDriverActiveRide,
  useOpenRides,
  usePendingRatingRide,
} from '@/features/rides/application/useRides';
import type { OpenRide } from '@/features/rides/domain/types';
import { useAutoExpireOffers, useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { useDriverToasts } from '@/features/driver/application/useDriverToasts';
import { FeedbackState } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';
import type { VehicleType } from '@/features/auth/domain/types';

type ViewMode = 'list' | 'map';

export function IncomingRequestsScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const focused = useIsFocused();
  const user = useAuthStore((s) => s.user);
  const online = user?.isOnline ?? false;
  const { mutate: setDriverOnline, isPending: isSettingOnline } = useSetOnline();
  const automaticActivationFor = useRef<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [mapHeaderHeight, setMapHeaderHeight] = useState(140);
  const activateDriver = useCallback(() => {
    if (!user) return;
    setAvailabilityError(null);
    setDriverOnline(true, {
      onError: (error) => {
        const message = getApiErrorMessage(error);
        setAvailabilityError(message);
        useDriverToasts.getState().push({
          kind: 'connection_error',
          rideId: 'availability',
          title: 'No pudimos activar la recepción de solicitudes',
          message,
        });
      },
    });
  }, [setDriverOnline, user]);

  useEffect(() => {
    if (!user) {
      automaticActivationFor.current = null;
      return;
    }
    // Switching vehicle goes offline first and keeps this screen mounted, so the
    // automatic activation is keyed by user *and* active vehicle.
    const activationKey = `${user.id}:${user.vehicleType ?? ''}`;
    if (user.isOnline || automaticActivationFor.current === activationKey) return;

    automaticActivationFor.current = activationKey;
    activateDriver();
  }, [activateDriver, user]);

  const activeQuery = useDriverActiveRide();
  const pendingRatingQuery = usePendingRatingRide();
  const activeRide = activeQuery.ride;
  const pendingRatingRide = pendingRatingQuery.ride;
  const flowLoading =
    activeQuery.isLoading ||
    (!activeRide && pendingRatingQuery.isLoading);
  const flowError =
    !activeRide && (activeQuery.isError || pendingRatingQuery.isError);
  const openRidesEnabled =
    online &&
    !flowLoading &&
    !flowError &&
    !activeRide &&
    !pendingRatingRide;
  const openRidesQuery = useOpenRides(openRidesEnabled);
  const rides = openRidesQuery.rides;
  const createOffer = useOfferComposer();
  // Continuous location (navigation): the map follows the driver, centered, in the
  // searching state and behind the requests list.
  const position = useWatchPosition(focused && !activeRide && !pendingRatingRide);

  const dismissed = useDriverRequests((s) => s.dismissed);
  // Self-healing: expires on the client the offers that ran out if the WS was lost
  // (e.g. the driver switched accounts during the offer's 30 s).
  useAutoExpireOffers();
  const rejected = useDriverRequests((s) => s.rejected);
  const expired = useDriverRequests((s) => s.expired);
  const paused = useDriverRequests((s) => s.paused);
  const taken = useDriverRequests((s) => s.taken);
  const offeredMap = useDriverRequests((s) => s.offered);
  const isOffered = useDriverRequests((s) => s.isOffered);
  const dismiss = useDriverRequests((s) => s.dismiss);
  const beginOfferAttempt = useDriverRequests((s) => s.beginOfferAttempt);
  const markOffered = useDriverRequests((s) => s.markOffered);
  const withdrawOffer = useWithdrawOffer();
  const dismissOpenRide = useDismissOpenRide();

  const [mode, setMode] = useState<ViewMode>('list');
  const [priceInputFor, setPriceInputFor] = useState<OpenRide | null>(null);
  const [customPrice, setCustomPrice] = useState('');
  // Ride to select when opening the map from the list (tap a card).
  const [selectedForMap, setSelectedForMap] = useState<string | null>(null);
  // Ephemeral "Oferta enviada" feedback when sending an offer.
  const [offerSent, setOfferSent] = useState(false);

  const visibleRides = useMemo(
    () => (online ? rides.filter((r) => !dismissed.has(r.id)) : []),
    [online, rides, dismissed],
  );
  const loadMoreOpenRides = useCallback(() => {
    if (
      openRidesQuery.hasNextPage &&
      !openRidesQuery.isFetchingNextPage &&
      !openRidesQuery.isFetchNextPageError
    ) {
      void openRidesQuery.fetchNextPage();
    }
  }, [openRidesQuery]);

  // The backend may filter by presence after resolving the cursor and
  // return an empty page with a continuation. Keep advancing until finding
  // a visible request or running out of pages, without overlapping requests or
  // automatically retrying a page that already failed.
  useEffect(() => {
    if (openRidesEnabled && visibleRides.length === 0) {
      loadMoreOpenRides();
    }
  }, [loadMoreOpenRides, openRidesEnabled, visibleRides.length]);

  // Only the request being submitted is busy; other passengers remain available.
  const pendingRideIds = createOffer.pendingRideIds;

  // Offering does NOT take the driver out of the list: the card switches to "Oferta enviada".
  const acceptAtFare = (ride: OpenRide) => {
    if (createOffer.isRidePending(ride.id)) return;
    const attemptToken = beginOfferAttempt(ride.id);
    createOffer.mutate(
      { rideId: ride.id, riderName: ride.rider.fullName, poolVersion: ride.poolVersion, pickup: ride.origin.coordinates, service: ride.service, input: { acceptAtFare: true } },
      {
        onSuccess: (offer) => {
          if (markOffered(ride.id, offer, ride.fare, attemptToken)) {
            setOfferSent(true);
          }
        },
        onError: (error) => {
          useDriverToasts.getState().push({
            kind: 'connection_error',
            rideId: ride.id,
            title: 'No pudimos enviar tu oferta',
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  };

  // Quick counter-offer (+Bs): instantly sends price = passenger's fare + delta.
  const quickAdd = (ride: OpenRide, delta: number) => {
    if (createOffer.isRidePending(ride.id)) return;
    const price = Math.round((ride.fare + delta) * 100) / 100;
    const attemptToken = beginOfferAttempt(ride.id);
    createOffer.mutate(
      { rideId: ride.id, riderName: ride.rider.fullName, poolVersion: ride.poolVersion, pickup: ride.origin.coordinates, service: ride.service, input: { acceptAtFare: false, price } },
      {
        onSuccess: (offer) => {
          if (markOffered(ride.id, offer, ride.fare, attemptToken)) {
            setOfferSent(true);
          }
        },
        onError: (error) => {
          useDriverToasts.getState().push({
            kind: 'connection_error',
            rideId: ride.id,
            title: 'No pudimos enviar tu contraoferta',
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  };

  const openPriceInput = (ride: OpenRide) => {
    if (createOffer.isRidePending(ride.id)) return;
    setCustomPrice(formatBolivianosInput(ride.fare));
    setPriceInputFor(ride);
  };

  const priceBusy = priceInputFor != null && pendingRideIds.has(priceInputFor.id);
  const parsedCustomPrice = Number(customPrice.replace(',', '.'));
  const customPriceIsValid = Number.isFinite(parsedCustomPrice) && parsedCustomPrice > 0;

  const submitCustomPrice = () => {
    if (!priceInputFor || !customPriceIsValid || createOffer.isRidePending(priceInputFor.id)) return;
    const ride = priceInputFor;
    setPriceInputFor(null);
    const attemptToken = beginOfferAttempt(ride.id);
    createOffer.mutate(
      { rideId: ride.id, riderName: ride.rider.fullName, poolVersion: ride.poolVersion, pickup: ride.origin.coordinates, service: ride.service, input: { acceptAtFare: false, price: parsedCustomPrice } },
      {
        onSuccess: (offer) => {
          const applied = markOffered(
            ride.id,
            offer,
            ride.fare,
            attemptToken,
          );
          setPriceInputFor(null);
          if (applied) setOfferSent(true);
        },
      },
    );
  };

  // Withdraw the offer sent to a request (from the list or the map).
  const withdraw = (ride: OpenRide) => {
    const offer = useDriverRequests.getState().getOffer(ride.id);
    if (!offer) return;
    withdrawOffer.mutate(offer.offerId, {
      onSuccess: () =>
        useDriverRequests.getState().markWithdrawn(ride.id, offer.offerId),
      onError: (error) => {
        useDriverToasts.getState().push({
          kind: 'connection_error',
          rideId: ride.id,
          title: 'No pudimos retirar tu oferta',
          message: getApiErrorMessage(error),
        });
      },
    });
  };

  const dismissRide = (ride: OpenRide) => {
    dismissOpenRide.mutate(ride.id, {
      onSuccess: () => dismiss(ride.id, ride.poolVersion),
      onError: (error) => {
        useDriverToasts.getState().push({
          kind: 'connection_error',
          rideId: ride.id,
          title: 'No pudimos rechazar la solicitud',
          message: getApiErrorMessage(error),
        });
      },
    });
  };

  // List: tapping a card ALWAYS opens the map with that request selected
  // (regardless of its status). The status shows on the map card; from there,
  // tapping it opens the status screen (openStatus).
  const openInMap = (ride: OpenRide) => {
    setSelectedForMap(ride.id);
    setMode('map');
  };

  // Map: tapping the floating card of a sent/expired/rejected offer opens
  // the status screen (waiting for confirmation).
  const openStatus = (ride: OpenRide) => {
    if (isOffered(ride.id) || rejected.has(ride.id) || expired.has(ride.id)) {
      router.push({ pathname: '/(driver)/oferta-enviada', params: { rideId: ride.id } });
    }
  };

  if (activeRide) {
    return <DriverTripInProgressScreen ride={activeRide} />;
  }

  if (flowError) {
    return (
      <DriverFlowRecovery
        error={getApiErrorMessage(
          activeQuery.isError ? activeQuery.error : pendingRatingQuery.error,
        )}
        onRetry={() => {
          void activeQuery.refetch();
          void pendingRatingQuery.refetch();
        }}
      />
    );
  }

  if (flowLoading) {
    return <DriverFlowRecovery />;
  }

  if (pendingRatingRide) {
    return <DriverTripInProgressScreen ride={pendingRatingRide} />;
  }

  if (availabilityError) {
    return (
      <DriverRequestsState
        error={availabilityError}
        onRetry={() => {
          automaticActivationFor.current = null;
          activateDriver();
        }}
      />
    );
  }

  if (!online || isSettingOnline || (openRidesEnabled && openRidesQuery.isLoading)) {
    return <DriverRequestsState loading loadingTitle="Preparando tus solicitudes…" />;
  }

  if (openRidesEnabled && openRidesQuery.isError && rides.length === 0) {
    return (
      <DriverRequestsState
        error={getApiErrorMessage(openRidesQuery.error)}
        onRetry={() => void openRidesQuery.refetch()}
      />
    );
  }

  if (visibleRides.length === 0) {
    return <SearchingState position={position} vehicleType={user?.vehicleType ?? null} />;
  }

  const requestsHeader = (
    <RequestsHeader
      count={visibleRides.length}
      pendingOffers={Object.keys(offeredMap).length}
      sendingOffers={pendingRideIds.size}
      mode={mode}
      onChangeMode={setMode}
    />
  );
  const requestsWarning = openRidesQuery.isError ? (
    <TouchableOpacity
      style={styles.requestsWarning}
      onPress={() => void openRidesQuery.refetch()}
      accessibilityRole="button"
      accessibilityLabel="Reintentar actualización de solicitudes">
      <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
      <Text style={styles.requestsWarningText}>Sin conexión. Toca para actualizar.</Text>
      <Ionicons name="refresh" size={18} color={colors.primary} />
    </TouchableOpacity>
  ) : null;

  return (
    <View style={styles.root}>
      {mode === 'map' ? (
        <View style={styles.mapLayer}>
          <RequestsMap
            key={selectedForMap ?? 'default'}
            rides={visibleRides}
            topOverlayHeight={mapHeaderHeight}
            disabled={withdrawOffer.isPending || dismissOpenRide.isPending}
            isOffered={isOffered}
            pendingRideIds={pendingRideIds}
            offeredMap={offeredMap}
            rejected={rejected}
            expired={expired}
            paused={paused}
            taken={taken}
            initialSelectedId={selectedForMap}
            hasNextPage={openRidesQuery.hasNextPage}
            isFetchingNextPage={openRidesQuery.isFetchingNextPage}
            onEndReached={loadMoreOpenRides}
            onOpenDetail={openStatus}
            onAccept={acceptAtFare}
            onDismiss={dismissRide}
            onQuickAdd={quickAdd}
            onOpenPriceInput={openPriceInput}
            onWithdraw={withdraw}
          />
          <View pointerEvents="box-none" style={styles.mapHeader}
            onLayout={(event) => setMapHeaderHeight(event.nativeEvent.layout.height)}>
            {requestsHeader}
            {requestsWarning}
            {createOffer.offerFeedback}
          </View>
        </View>
      ) : (
        <>
          <DriverSearchMap
            coordinates={position.coordinates}
            heading={position.heading}
            vehicleType={user?.vehicleType ?? null}
            status={position.status}
            retry={position.retry}
          />
          <View style={styles.scrim} pointerEvents="box-none">
            {requestsHeader}
            {requestsWarning}
            {createOffer.offerFeedback}
            <FlatList
              style={styles.list}
              data={visibleRides}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <RequestCard
                  ride={item}
                  offered={isOffered(item.id)}
                  rejected={rejected.has(item.id)}
                  expired={expired.has(item.id)}
                  paused={paused.has(item.id)}
                  taken={taken.has(item.id)}
                  disabled={pendingRideIds.has(item.id) || withdrawOffer.isPending || dismissOpenRide.isPending}
                  pendingAccept={pendingRideIds.has(item.id)}
                  offerExpiresAt={offeredMap[item.id]?.expiresAt ?? null}
                  offerPrice={offeredMap[item.id]?.price ?? null}
                  onPress={() => openInMap(item)}
                  onViewOffer={() => openStatus(item)}
                  onAccept={() => acceptAtFare(item)}
                  onDismiss={() => dismissRide(item)}
                  onQuickAdd={(delta) => quickAdd(item, delta)}
                  onOpenPriceInput={() => openPriceInput(item)}
                  onWithdraw={() => withdraw(item)}
                />
              )}
              onEndReached={loadMoreOpenRides}
              onEndReachedThreshold={0.35}
              ListFooterComponent={
                openRidesQuery.isFetchingNextPage ? (
                  <ActivityIndicator
                    style={styles.pageLoader}
                    color={colors.primary}
                  />
                ) : null
              }
            />
          </View>
        </>
      )}

      <Modal
        visible={priceInputFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPriceInputFor(null)}>
        <KeyboardAvoidingView
          style={styles.priceModalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.priceModal}>
            <Text style={styles.priceModalTitle}>Tu contraoferta</Text>
            <Text style={styles.priceModalHint}>
              El pasajero ofrece Bs {formatBolivianos(priceInputFor?.fare ?? 0)}
            </Text>
            <View style={styles.priceInputRow}>
              <Text style={styles.priceCurrency}>Bs</Text>
              <TextInput
                autoFocus
                value={customPrice}
                onChangeText={setCustomPrice}
                selectTextOnFocus
                placeholder="30"
                placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={9}
                style={styles.priceInput}
                accessibilityLabel="Monto de la contraoferta en bolivianos"
                onSubmitEditing={submitCustomPrice}
              />
            </View>
            <View style={styles.priceModalActions}>
              <TouchableOpacity
                style={styles.priceModalCancel}
                onPress={() => setPriceInputFor(null)}
                disabled={priceBusy}
                accessibilityRole="button"
                accessibilityLabel="Cancelar contraoferta">
                <Text style={styles.priceModalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.priceModalSubmit,
                  (!customPriceIsValid || priceBusy) && styles.disabled,
                ]}
                onPress={submitCustomPrice}
                disabled={!customPriceIsValid || priceBusy}
                accessibilityRole="button"
                accessibilityLabel="Enviar contraoferta">
                {priceBusy ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.priceModalSubmitText}>Enviar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <OfferSentOverlay visible={offerSent} onDone={() => setOfferSent(false)} />
    </View>
  );
}

function DriverFlowRecovery({
  error,
  onRetry,
}: {
  error?: string;
  onRetry?: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.recovery}>
      {error ? (
        <Ionicons name="cloud-offline-outline" size={44} color={colors.textSecondary} />
      ) : (
        <ActivityIndicator size="large" color={colors.primary} />
      )}
      <Text style={styles.recoveryTitle}>
        {error ? 'No pudimos verificar tus viajes' : 'Recuperando tu viaje…'}
      </Text>
      {error && <Text style={styles.recoveryHint}>{error}</Text>}
      {onRetry && (
        <TouchableOpacity
          style={styles.recoveryButton}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Reintentar recuperación del viaje">
          <Text style={styles.recoveryButtonText}>Reintentar</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

function DriverRequestsState({
  loading = false,
  loadingTitle,
  error,
  onRetry,
}: {
  loading?: boolean;
  loadingTitle?: string;
  error?: string;
  onRetry?: () => void;
}) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.requestsState} edges={['bottom']}>
      <RequestsHeader count={0} />
      <FeedbackState
        loading={loading}
        icon="cloud-offline-outline"
        title={loading ? (loadingTitle ?? 'Cargando solicitudes…') : 'No pudimos cargar las solicitudes'}
        message={error}
        actionLabel={onRetry ? 'Reintentar' : undefined}
        onAction={onRetry}
      />
    </SafeAreaView>
  );
}

/** Estado sin solicitudes: mapa y radar. */
function SearchingState({
  position,
  vehicleType,
}: {
  position: WatchedPosition;
  vehicleType: VehicleType | null;
}) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.root}>
      <DriverSearchMap
        coordinates={position.coordinates} heading={position.heading} vehicleType={vehicleType}
        status={position.status} retry={position.retry} showRadar
      />
      <View style={styles.scrim} pointerEvents="box-none">
        <RequestsHeader count={0} />
      </View>
    </View>
  );
}

function RequestsHeader({
  count,
  pendingOffers = 0,
  sendingOffers = 0,
  mode,
  onChangeMode,
}: {
  count: number;
  pendingOffers?: number;
  sendingOffers?: number;
  mode?: ViewMode;
  onChangeMode?: (mode: ViewMode) => void;
}) {
  const { styles } = useThemedStyles(createStyles);
  const hasModeSwitch = mode != null && onChangeMode != null;
  return (
    <SafeAreaView edges={['top']} style={styles.requestsHeaderSafe} pointerEvents="box-none">
      <View style={styles.requestsHeader}>
        <View style={styles.requestsHeaderRow}>
          <View style={styles.requestsHeaderText}>
            <Text style={styles.requestsTitle}>Solicitudes</Text>
            <Text style={styles.requestsSubtitle}>
              {count === 0
                ? 'Esperando nuevas solicitudes'
                : count === 1
                  ? '1 viaje disponible'
                  : `${count} viajes disponibles`}
            </Text>
          </View>
          {hasModeSwitch && <ViewModeToggle mode={mode} onChange={onChangeMode} />}
        </View>
        {count > 0 && (
          <Text style={styles.requestsSubtitle} accessibilityLiveRegion="polite">
            {pendingOffers > 0 ? `${pendingOffers} ${pendingOffers === 1 ? 'oferta en espera' : 'ofertas en espera'}. ` : ''}
            {sendingOffers > 0 ? `Enviando ${sendingOffers}… ` : ''}
            Puedes ofertar a varios pasajeros.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.toggle} accessibilityRole="tablist">
      <ToggleButton
        icon="list"
        label="Lista"
        active={mode === 'list'}
        onPress={() => onChange('list')}
      />
      <ToggleButton
        icon="map"
        label="Mapa"
        active={mode === 'map'}
        onPress={() => onChange('map')}
      />
    </View>
  );
}

function ToggleButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IoniconsIconName;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={[styles.toggleBtn, active && styles.toggleBtnActive]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Ver en ${label.toLowerCase()}`}>
      <Ionicons name={icon} size={14} color={active ? colors.primary : colors.textSecondary} />
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  requestsState: { flex: 1, backgroundColor: colors.background },
  recovery: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  recoveryTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
  recoveryHint: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  recoveryButton: {
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  recoveryButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  // "With requests" state — list mode (over the background map).
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
  pageLoader: { marginVertical: spacing.md },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
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
  disabled: { opacity: 0.5 },

  // Modo mapa.
  mapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mapHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    gap: spacing.xs,
  },
  requestsHeaderSafe: {},
  requestsHeader: {
    marginHorizontal: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  requestsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  requestsHeaderText: { flex: 1 },
  requestsTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  requestsSubtitle: { marginTop: 2, fontSize: fontSize.xs, color: colors.textSecondary },
  requestsWarning: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  requestsWarningText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },

  // Toggle Lista/Mapa.
  toggle: {
    width: 116,
    flexDirection: 'row',
    minHeight: 38,
    padding: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    gap: spacing.xs,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
  },
  toggleBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  toggleText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  toggleTextActive: { color: colors.primary },


});
