import { useOfferComposer } from './useOfferComposer';
/**
 * Incoming requests (driver).
 *
 * Active ride → tracking; no requests → map with radar and a status card;
 * with requests → a top bar with the vehicle the driver works with and the
 * Lista/Mapa toggle. The list is sortable (closest, best Bs/km, newest) and
 * the map shows the driver, the selected route and every other request as a
 * price pin; both use the same `RequestCard`. The driver **offers** (does not
 * assign): an offer leaves the card on "Oferta enviada" and they keep seeing others.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBrandFontStyle } from '@/core/theme/brandFont';
import { VEHICLE_META } from '@/features/auth/domain/vehicleCatalog';
import { orderRequests, type RequestOrder } from '@/features/driver/domain/requestOrder';
import { CounterOfferSheet } from '@/features/driver/presentation/CounterOfferSheet';
import { DriverSearchMap } from '@/features/driver/presentation/DriverSearchMap';
import { OfferSentOverlay } from '@/features/driver/presentation/OfferSentOverlay';
import { RequestCard } from '@/features/driver/presentation/RequestCard';
import { RequestsMap } from '@/features/driver/presentation/RequestsMap';
import { DriverTripInProgressScreen } from '@/features/driver/presentation/DriverTripInProgressScreen';
import { useWatchPosition, type WatchedPosition } from '@/features/home/application/useWatchPosition';
import {
  useDismissOpenRide,
  useSetOnline,
  useWithdrawOffer,
} from '@/features/rides/application/useRideMutations';
import { haversineKm } from '@/features/rides/domain/geo';
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
  // ~100 m grid: the cards' pickup distance should not re-render on every 1 s fix.
  const gridLatitude = position.coordinates ? Math.round(position.coordinates.latitude * 1000) / 1000 : null;
  const gridLongitude = position.coordinates ? Math.round(position.coordinates.longitude * 1000) / 1000 : null;
  const cardDriverCoordinates = useMemo(() => gridLatitude != null && gridLongitude != null
    ? { latitude: gridLatitude, longitude: gridLongitude } : null, [gridLatitude, gridLongitude]);

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
  const [order, setOrder] = useState<RequestOrder>('nearest');
  const [counterFor, setCounterFor] = useState<OpenRide | null>(null);
  // Ride to select when opening the map from the list (tap a card).
  const [selectedForMap, setSelectedForMap] = useState<string | null>(null);
  // Ephemeral "Oferta enviada" feedback when sending an offer.
  const [offerSent, setOfferSent] = useState(false);

  const visibleRides = useMemo(
    () => (online ? rides.filter((r) => !dismissed.has(r.id)) : []),
    [online, rides, dismissed],
  );
  // List and map share one order, so "1 de 4" on the map matches the list.
  const orderedRides = useMemo(() => orderRequests(visibleRides, order, {
    pickupKm: (ride) => cardDriverCoordinates ? haversineKm(cardDriverCoordinates, ride.origin.coordinates) : null,
    tripKm: (ride) => haversineKm(ride.origin.coordinates, ride.destination.coordinates),
  }), [visibleRides, order, cardDriverCoordinates]);
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

  // Counter-offer from the sheet: the sheet closes at once and the card shows "Enviando…".
  const openCounterOffer = (ride: OpenRide) => {
    if (createOffer.isRidePending(ride.id)) return;
    setCounterFor(ride);
  };

  const submitCounterOffer = (price: number) => {
    const ride = counterFor;
    if (!ride || createOffer.isRidePending(ride.id)) return;
    setCounterFor(null);
    const attemptToken = beginOfferAttempt(ride.id);
    createOffer.mutate(
      { rideId: ride.id, riderName: ride.rider.fullName, poolVersion: ride.poolVersion, pickup: ride.origin.coordinates, service: ride.service, input: { acceptAtFare: false, price } },
      {
        // Failures surface in `offerFeedback`, with "Reintentar oferta".
        onSuccess: (offer) => {
          if (markOffered(ride.id, offer, ride.fare, attemptToken)) setOfferSent(true);
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
      router.push({ pathname: '/(driver)/offer-sent', params: { rideId: ride.id } });
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

  const vehicle = { type: user?.vehicleType ?? null, plate: user?.plate ?? null };

  if (visibleRides.length === 0) {
    return <SearchingState position={position} vehicle={vehicle} />;
  }

  const pendingOffers = Object.keys(offeredMap).length;
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
  const busy = withdrawOffer.isPending || dismissOpenRide.isPending;

  return (
    <View style={styles.root}>
      {mode === 'map' ? (
        <View style={styles.mapLayer}>
          <RequestsMap
            key={selectedForMap ?? 'default'}
            rides={orderedRides}
            topOverlayHeight={mapHeaderHeight}
            driver={{ coordinates: position.coordinates, heading: position.heading, vehicleType: vehicle.type }}
            driverGridCoordinates={cardDriverCoordinates}
            disabled={busy}
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
            onCounterOffer={openCounterOffer}
            onWithdraw={withdraw}
          />
          <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.mapHeader}
            onLayout={(event) => setMapHeaderHeight(event.nativeEvent.layout.height)}>
            <RequestsTopBar vehicle={vehicle} mode={mode} onChangeMode={setMode} />
            {requestsWarning}
            {createOffer.offerFeedback}
          </SafeAreaView>
        </View>
      ) : (
        <SafeAreaView edges={['top']} style={styles.listScreen}>
          <FlatList
            data={orderedRides}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={styles.listHeader}>
                <RequestsTopBar vehicle={vehicle} mode={mode} onChangeMode={setMode} />
                <RequestsSummary count={visibleRides.length} pendingOffers={pendingOffers}
                  sendingOffers={pendingRideIds.size} />
                <OrderChips value={order} onChange={setOrder} nearestAvailable={cardDriverCoordinates != null} />
                {requestsWarning}
                {createOffer.offerFeedback}
              </View>
            }
            renderItem={({ item }) => (
              <RequestCard
                ride={item}
                offered={isOffered(item.id)}
                rejected={rejected.has(item.id)}
                expired={expired.has(item.id)}
                paused={paused.has(item.id)}
                taken={taken.has(item.id)}
                disabled={pendingRideIds.has(item.id) || busy}
                pendingAccept={pendingRideIds.has(item.id)}
                offerExpiresAt={offeredMap[item.id]?.expiresAt ?? null}
                offerPrice={offeredMap[item.id]?.price ?? null}
                onPress={() => openInMap(item)}
                onViewOffer={() => openStatus(item)}
                onAccept={() => acceptAtFare(item)}
                onDismiss={() => dismissRide(item)}
                onCounterOffer={() => openCounterOffer(item)}
                onWithdraw={() => withdraw(item)}
                driverCoordinates={cardDriverCoordinates}
              />
            )}
            onEndReached={loadMoreOpenRides}
            onEndReachedThreshold={0.35}
            ListFooterComponent={
              openRidesQuery.isFetchingNextPage ? (
                <ActivityIndicator style={styles.pageLoader} color={colors.primary} />
              ) : null
            }
          />
        </SafeAreaView>
      )}

      <CounterOfferSheet
        ride={counterFor}
        busy={counterFor != null && pendingRideIds.has(counterFor.id)}
        onClose={() => setCounterFor(null)}
        onSubmit={submitCounterOffer}
      />

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
  const user = useAuthStore((s) => s.user);
  return (
    <SafeAreaView style={styles.requestsState}>
      <RequestsTopBar vehicle={{ type: user?.vehicleType ?? null, plate: user?.plate ?? null }} />
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

type WorkingVehicle = { type: VehicleType | null; plate: string | null };

/** No requests yet: map with the radar and a status card. */
function SearchingState({
  position,
  vehicle,
}: {
  position: WatchedPosition;
  vehicle: WorkingVehicle;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  return (
    <View style={styles.root}>
      <DriverSearchMap
        coordinates={position.coordinates} heading={position.heading} vehicleType={vehicle.type}
        status={position.status} retry={position.retry} showRadar
      />
      <SafeAreaView edges={['top']} style={styles.scrim} pointerEvents="box-none">
        <RequestsTopBar vehicle={vehicle} />
        <View style={styles.flex} pointerEvents="none" />
        {position.coordinates && (
          <View style={styles.searchCard} accessibilityLiveRegion="polite">
            <View style={styles.searchRow}>
              <View style={styles.searchIcon}>
                <Ionicons name="radio-outline" size={26} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text accessibilityRole="header" style={[styles.searchTitle, brandFont]}>Buscando solicitudes</Text>
                {vehicle.type && (
                  <Text style={styles.searchSubtitle}>
                    {[VEHICLE_META[vehicle.type].label, vehicle.plate].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
            </View>
            <Text style={styles.searchHint}>
              Te mostraremos aquí cada solicitud nueva. Puedes ofertar a varias a la vez.
            </Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

/** Vehicle the driver works with (informative) and, with requests, the Lista/Mapa toggle. */
function RequestsTopBar({
  vehicle,
  mode,
  onChangeMode,
}: {
  vehicle: WorkingVehicle;
  mode?: ViewMode;
  onChangeMode?: (mode: ViewMode) => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.topBar} pointerEvents="box-none">
      {vehicle.type ? (
        <View
          style={styles.vehicleChip}
          accessible
          accessibilityLabel={`Trabajando con ${VEHICLE_META[vehicle.type].label}${vehicle.plate ? `, placa ${vehicle.plate}` : ''}`}>
          <Ionicons name={VEHICLE_META[vehicle.type].icon} size={18} color={colors.primary} />
          <Text style={styles.vehicleChipText} numberOfLines={1}>
            {VEHICLE_META[vehicle.type].label}
            {vehicle.plate ? <Text style={styles.vehicleChipPlate}> · {vehicle.plate}</Text> : null}
          </Text>
        </View>
      ) : <View />}
      {mode != null && onChangeMode != null && <ViewModeToggle mode={mode} onChange={onChangeMode} />}
    </View>
  );
}

function RequestsSummary({ count, pendingOffers, sendingOffers }: {
  count: number; pendingOffers: number; sendingOffers: number;
}) {
  const { styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  return (
    <View style={styles.summary}>
      <Text accessibilityRole="header" style={[styles.summaryTitle, brandFont]}>
        {count === 1 ? '1 solicitud disponible' : `${count} solicitudes disponibles`}
      </Text>
      <Text style={styles.summarySubtitle} accessibilityLiveRegion="polite">
        {[
          sendingOffers > 0 ? `Enviando ${sendingOffers}…` : null,
          pendingOffers > 0 ? `${pendingOffers} ${pendingOffers === 1 ? 'oferta en espera' : 'ofertas en espera'}` : null,
          'puedes ofertar a varias',
        ].filter(Boolean).join(' · ').replace(/^p/, (letter) => letter.toUpperCase())}
      </Text>
    </View>
  );
}

const ORDER_OPTIONS: { value: RequestOrder; label: string }[] = [
  { value: 'nearest', label: 'Más cerca' },
  { value: 'best', label: 'Mejor pago' },
  { value: 'recent', label: 'Recientes' },
];

function OrderChips({ value, onChange, nearestAvailable }: {
  value: RequestOrder; onChange: (order: RequestOrder) => void; nearestAvailable: boolean;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.orderRow} accessibilityLabel="Ordenar solicitudes">
      {ORDER_OPTIONS.map((option) => {
        const selected = option.value === value;
        // Without GPS "Más cerca" cannot rank anything; it stays selectable but says so.
        const hint = option.value === 'nearest' && !nearestAvailable ? 'Necesita tu ubicación' : undefined;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.orderChip, selected && styles.orderChipSelected]}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityHint={hint}>
            {selected && <Ionicons name="checkmark" size={15} color={colors.primary} />}
            <Text style={[styles.orderChipText, selected && styles.orderChipTextSelected]}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
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
      <ToggleButton icon="list" label="Lista" active={mode === 'list'} onPress={() => onChange('list')} />
      <ToggleButton icon="map-outline" label="Mapa" active={mode === 'map'} onPress={() => onChange('map')} />
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
      <Ionicons name={icon} size={16} color={active ? colors.textOnPrimary : colors.text} />
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  requestsState: { flex: 1, backgroundColor: colors.surfaceMuted },
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

  // Top bar shared by every state.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingTop: spacing.sm + 4,
  },
  vehicleChip: {
    flexShrink: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  vehicleChipText: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  vehicleChipPlate: { fontWeight: fontWeight.medium, color: colors.textSecondary },

  // List mode.
  listScreen: { flex: 1, backgroundColor: colors.surfaceMuted },
  listHeader: { gap: spacing.sm + 4, marginHorizontal: -spacing.sm - 4, paddingBottom: spacing.xs },
  listContent: { paddingHorizontal: spacing.sm + 4, gap: spacing.sm + 4, paddingBottom: spacing.xl },
  summary: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: 2 },
  summaryTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  summarySubtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  orderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md },
  orderChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  orderChipSelected: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  orderChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },
  orderChipTextSelected: { fontWeight: fontWeight.bold, color: colors.primary },
  pageLoader: { marginVertical: spacing.md },
  requestsWarning: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm + 4,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  requestsWarningText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },

  // Map mode.
  mapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mapHeader: { position: 'absolute', top: 0, left: 0, right: 0, gap: spacing.xs },

  // No requests yet.
  searchCard: {
    margin: spacing.sm,
    gap: spacing.sm + 4,
    padding: spacing.md,
    borderRadius: 20,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  searchIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  searchTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  searchSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  searchHint: { fontSize: fontSize.sm, lineHeight: 20, color: colors.text },

  // Lista/Mapa toggle.
  toggle: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toggleBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.pill,
  },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },
  toggleTextActive: { fontWeight: fontWeight.bold, color: colors.textOnPrimary },
});
