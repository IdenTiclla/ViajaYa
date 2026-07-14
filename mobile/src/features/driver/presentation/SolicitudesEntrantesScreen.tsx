/**
 * Solicitudes entrantes (conductor) — diseño Material-You.
 *
 * Tres estados: viaje activo → seguimiento; sin solicitudes → mapa con radar y
 * estado compacto; con solicitudes → cabecera glass
 * + toggle Lista/Mapa y tarjetas translúcidas. El conductor **oferta** (no
 * asigna): Enviar oferta deja la tarjeta en "Oferta enviada" y sigue viendo otras.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { DriverSearchMap } from '@/features/driver/presentation/DriverSearchMap';
import { OfferSentOverlay } from '@/features/driver/presentation/OfferSentOverlay';
import { RadarPulse } from '@/features/driver/presentation/RadarPulse';
import { RequestCard } from '@/features/driver/presentation/RequestCard';
import { SolicitudesMapa } from '@/features/driver/presentation/SolicitudesMapa';
import { ViajeEnCursoConductorScreen } from '@/features/driver/presentation/ViajeEnCursoConductorScreen';
import { useWatchPosition, type WatchedPosition } from '@/features/home/application/useWatchPosition';
import {
  useCreateOffer,
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

type ViewMode = 'list' | 'map';

export function SolicitudesEntrantesScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const online = user?.isOnline ?? false;
  const { mutate: setDriverOnline, isPending: isSettingOnline } = useSetOnline();
  const automaticActivationFor = useRef<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
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
    if (user.isOnline || automaticActivationFor.current === user.id) return;

    automaticActivationFor.current = user.id;
    activateDriver();
  }, [activateDriver, user]);

  const activeQuery = useDriverActiveRide();
  const pendingRatingQuery = usePendingRatingRide();
  const activeRide = activeQuery.ride;
  const pendingRatingRide = pendingRatingQuery.ride;
  const flowLoading =
    activeQuery.isLoading ||
    (!activeRide &&
      (pendingRatingQuery.isLoading ||
        (!pendingRatingRide && pendingRatingQuery.isFetching)));
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
  const createOffer = useCreateOffer();
  // Ubicación continua (navegación): el mapa sigue al conductor centrado en el
  // estado de búsqueda y detrás de la lista de solicitudes.
  const position = useWatchPosition();

  const dismissed = useDriverRequests((s) => s.dismissed);
  // Autocuración: expira en cliente las ofertas vencidas si se perdió el WS
  // (p. ej. el conductor cambió de cuenta durante los 30 s de la oferta).
  useAutoExpireOffers();
  const rejected = useDriverRequests((s) => s.rejected);
  const expired = useDriverRequests((s) => s.expired);
  const paused = useDriverRequests((s) => s.paused);
  const taken = useDriverRequests((s) => s.taken);
  const offeredMap = useDriverRequests((s) => s.offered);
  const isOffered = useDriverRequests((s) => s.isOffered);
  const dismiss = useDriverRequests((s) => s.dismiss);
  const markOffered = useDriverRequests((s) => s.markOffered);
  const withdrawOffer = useWithdrawOffer();
  const dismissOpenRide = useDismissOpenRide();

  const [mode, setMode] = useState<ViewMode>('list');
  const [priceInputFor, setPriceInputFor] = useState<OpenRide | null>(null);
  const [customPrice, setCustomPrice] = useState('');
  // Ride a seleccionar al abrir el mapa desde la lista (toca una tarjeta).
  const [selectedForMap, setSelectedForMap] = useState<string | null>(null);
  // Feedback efímero "Oferta enviada" al enviar una oferta.
  const [offerSent, setOfferSent] = useState(false);

  const visibleRides = useMemo(
    () => (online ? rides.filter((r) => !dismissed.has(r.id)) : []),
    [online, rides, dismissed],
  );

  // Ride cuya oferta está en curso (para el "Enviando…" de su tarjeta).
  // Gate por isPending: `createOffer.variables` persiste tras el onSuccess (React
  // Query no lo limpia), así que sin este gate el botón quedaría en spinner fijo.
  const pendingRideId = createOffer.isPending ? createOffer.variables?.rideId ?? null : null;

  // Ofertar NO saca al conductor de la lista: la tarjeta pasa a "Oferta enviada".
  const acceptAtFare = (ride: OpenRide) => {
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: true } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer, ride.fare);
          setOfferSent(true);
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

  // Contraoferta rápida (+Bs): envía al instante precio = oferta del pasajero + delta.
  const quickAdd = (ride: OpenRide, delta: number) => {
    const price = Math.round((ride.fare + delta) * 100) / 100;
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: false, price } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer, ride.fare);
          setOfferSent(true);
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
    createOffer.reset();
    setCustomPrice(formatBolivianosInput(ride.fare));
    setPriceInputFor(ride);
  };

  const parsedCustomPrice = Number(customPrice.replace(',', '.'));
  const customPriceIsValid = Number.isFinite(parsedCustomPrice) && parsedCustomPrice > 0;

  const submitCustomPrice = () => {
    if (!priceInputFor || !customPriceIsValid || createOffer.isPending) return;
    const ride = priceInputFor;
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: false, price: parsedCustomPrice } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer, ride.fare);
          setPriceInputFor(null);
          setOfferSent(true);
        },
      },
    );
  };

  // Retira la oferta enviada a una solicitud (desde la lista o el mapa).
  const withdraw = (ride: OpenRide) => {
    const offer = useDriverRequests.getState().getOffer(ride.id);
    if (!offer) return;
    withdrawOffer.mutate(offer.offerId, {
      onSuccess: () => useDriverRequests.getState().clearRide(ride.id),
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

  // Lista: al tocar una tarjeta abre SIEMPRE el mapa con esa solicitud seleccionada
  // (sin importar su estado). El estado se ve en la card del mapa; desde ahí, al
  // tocarla, se abre la pantalla de estado (openStatus).
  const openInMap = (ride: OpenRide) => {
    setSelectedForMap(ride.id);
    setMode('map');
  };

  // Mapa: al tocar la card flotante de una oferta enviada/expirada/rechazada, abre
  // la pantalla de estado (esperando confirmación).
  const openStatus = (ride: OpenRide) => {
    if (isOffered(ride.id) || rejected.has(ride.id) || expired.has(ride.id)) {
      router.push({ pathname: '/(driver)/oferta-enviada', params: { rideId: ride.id } });
    }
  };

  if (activeRide) {
    return <ViajeEnCursoConductorScreen ride={activeRide} />;
  }

  if (flowLoading) {
    return <DriverFlowRecovery />;
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

  if (pendingRatingRide) {
    return <ViajeEnCursoConductorScreen ride={pendingRatingRide} />;
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
    return <SearchingState position={position} />;
  }

  const requestsHeader = (
    <RequestsHeader
      count={visibleRides.length}
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
          <SolicitudesMapa
            key={selectedForMap ?? 'default'}
            rides={visibleRides}
            disabled={createOffer.isPending || withdrawOffer.isPending || dismissOpenRide.isPending}
            isOffered={isOffered}
            pendingRideId={pendingRideId}
            offeredMap={offeredMap}
            rejected={rejected}
            expired={expired}
            paused={paused}
            taken={taken}
            initialSelectedId={selectedForMap}
            onOpenDetail={openStatus}
            onAccept={acceptAtFare}
            onDismiss={dismissRide}
            onQuickAdd={quickAdd}
            onOpenPriceInput={openPriceInput}
            onWithdraw={withdraw}
          />
          <View pointerEvents="box-none" style={styles.mapHeader}>
            {requestsHeader}
            {requestsWarning}
          </View>
        </View>
      ) : (
        <>
          <DriverSearchMap
            coordinates={position.coordinates}
            status={position.status}
            retry={position.retry}
          />
          <View style={styles.scrim} pointerEvents="box-none">
            {requestsHeader}
            {requestsWarning}
            {createOffer.isError && (
              <Text style={styles.error}>{getApiErrorMessage(createOffer.error)}</Text>
            )}
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}>
              {visibleRides.map((item) => (
                <RequestCard
                  key={item.id}
                  ride={item}
                  offered={isOffered(item.id)}
                  rejected={rejected.has(item.id)}
                  expired={expired.has(item.id)}
                  paused={paused.has(item.id)}
                  taken={taken.has(item.id)}
                  disabled={createOffer.isPending || withdrawOffer.isPending || dismissOpenRide.isPending}
                  pendingAccept={pendingRideId === item.id}
                  offerExpiresAt={offeredMap[item.id]?.expiresAt ?? null}
                  offerPrice={offeredMap[item.id]?.price ?? null}
                  onPress={() => openInMap(item)}
                  onAccept={() => acceptAtFare(item)}
                  onDismiss={() => dismissRide(item)}
                  onQuickAdd={(delta) => quickAdd(item, delta)}
                  onOpenPriceInput={() => openPriceInput(item)}
                  onWithdraw={() => withdraw(item)}
                />
              ))}
            </ScrollView>
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
            {createOffer.isError && (
              <Text style={styles.priceModalError}>{getApiErrorMessage(createOffer.error)}</Text>
            )}
            <View style={styles.priceModalActions}>
              <TouchableOpacity
                style={styles.priceModalCancel}
                onPress={() => setPriceInputFor(null)}
                disabled={createOffer.isPending}
                accessibilityRole="button"
                accessibilityLabel="Cancelar contraoferta">
                <Text style={styles.priceModalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.priceModalSubmit,
                  (!customPriceIsValid || createOffer.isPending) && styles.disabled,
                ]}
                onPress={submitCustomPrice}
                disabled={!customPriceIsValid || createOffer.isPending}
                accessibilityRole="button"
                accessibilityLabel="Enviar contraoferta">
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
}: {
  position: WatchedPosition;
}) {
  return (
    <View style={styles.root}>
      <DriverSearchMap coordinates={position.coordinates} status={position.status} retry={position.retry} />
      <View style={styles.scrim} pointerEvents="box-none">
        <RequestsHeader count={0} />

        {/* Pulso centrado: el mapa sigue al conductor centrado, así que coincide
            con su ubicación. El ícono rota según el rumbo del vehículo. */}
        {position.coordinates && (
          <View style={styles.radarLayer} pointerEvents="none">
            <RadarPulse heading={position.heading} />
          </View>
        )}
      </View>
    </View>
  );
}

function RequestsHeader({
  count,
  mode,
  onChangeMode,
}: {
  count: number;
  mode?: ViewMode;
  onChangeMode?: (mode: ViewMode) => void;
}) {
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
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
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

const styles = StyleSheet.create({
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

  // Estado "con solicitudes" — modo lista (sobre el mapa de fondo).
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
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
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
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
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F5C6C2',
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

  radarLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

});
