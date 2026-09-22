/**
 * Configurar viaje — paso final del flujo: muestra origen y destino marcados en
 * el mapa, unidos por el trayecto real por calles (Google Routes API), y permite
 * elegir servicio, proponer una oferta y buscar ofertas de conductores.
 *
 * The camera stays locked around the complete road route.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRoute } from '@/features/booking/application/useRoute';
import { useTripPlaceLabels } from '@/features/booking/application/useTripPlaceLabels';
import { useCreateRide } from '@/features/booking/application/useCreateRide';
import {
  BOLIVIA_SERVICE_AREA_MESSAGE,
  getBoliviaPlaceError,
} from '@/features/booking/domain/bolivia';
import {
  getPlaceStreetName,
  isPlaceLabelResolved,
} from '@/features/booking/domain/placeLabels';
import type { Coordinates, PaymentMethod } from '@/features/booking/domain/types';
import {
  SelectableOptionCards,
  type SelectableOption,
} from '@/features/booking/presentation/SelectableOptionCards';
import { ServiceTypeSelector } from '@/features/booking/presentation/ServiceTypeSelector';
import { useCancelRide, useEditRide } from '@/features/rides/application/useRideMutations';
import { formatBolivianosInput } from '@/features/rides/domain/money';
import {
  PASSENGER_ACTIVE_RIDE_KEY,
  useRide,
} from '@/features/rides/application/useRides';
import { useEstiloMapa } from '@/features/booking/presentation/mapStyle';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';
import { RoutePolyline } from '@/features/rides/presentation/RoutePolyline';
import { useRumboMapa } from '@/features/rides/application/useRumboMapa';
import { MotorcycleRouteNotice } from '@/features/rides/presentation/MotorcycleRouteNotice';
import { Button, ConfirmDialog, FeedbackState } from '@/shared/components';

const PAYMENTS: readonly SelectableOption<PaymentMethod>[] = [
  { id: 'cash', label: 'Efectivo', icon: 'cash', accessibilityLabel: 'Pagar con efectivo' },
  { id: 'qr', label: 'QR', icon: 'qr-code', accessibilityLabel: 'Pagar con QR' },
];

// Mismo encuadre lateral del mapa de solicitudes del conductor. Abajo se usa el
// alto real del panel para mantener todo el trayecto en el área visible.
const FIT_SIDES = 32;
const MIN_KEYBOARD_TRANSLATION = 280;

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function ConfigureTripScreen() {
  const { colors, styles } = useEstilos(crearEstilos);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const isEditing = !!rideId;
  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const setOrigin = useBookingStore((s) => s.setOrigin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const service = useBookingStore((s) => s.service);
  const setService = useBookingStore((s) => s.setService);
  const payment = useBookingStore((s) => s.payment);
  const setPayment = useBookingStore((s) => s.setPayment);
  const fare = useBookingStore((s) => s.fare);
  const setFare = useBookingStore((s) => s.setFare);
  const {
    labelsReady,
    isResolving: labelsResolving,
    error: labelsError,
    retry: retryLabels,
  } = useTripPlaceLabels();
  const mapRef = useRef<MapView>(null);
  const { rumboMapa, zoomMapa, actualizarRumbo } = useRumboMapa(mapRef);
  const queryClient = useQueryClient();
  const editRide = useEditRide();
  const cancelRecoveryRide = useCancelRide();
  // Alto real del bottom sheet, para encuadrar los puntos por encima de él.
  const [sheetHeight, setSheetHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(insets.top + 56);
  const [mapReady, setMapReady] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  // Mostrar/ocultar etiquetas de lugares (el usuario lo controla con el toggle).
  const [showPlaces, setShowPlaces] = useState(false);
  const { estiloMapa, modoMapa } = useEstiloMapa(!showPlaces);
  const [confirmExit, setConfirmExit] = useState(false);
  const [manualExit, setAllowExit] = useState(false);
  const [exitAfterSave, setExitAfterSave] = useState(false);
  const [exitHome, setExitHome] = useState(false);
  const [confirmRecoveryCancel, setConfirmRecoveryCancel] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = event.endCoordinates.height;
      setKeyboardHeight(height);
      // `screenY` no es estable con adjustResize entre fabricantes. Trasladar
      // por la altura completa garantiza que la oferta quede sobre el teclado.
      setKeyboardOffset(Math.max(height, MIN_KEYBOARD_TRANSLATION));
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      setKeyboardOffset(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const createRide = useCreateRide();

  // Modo edición (Modificar solicitud): el llamador (Offers/Searching) ya pausó
  // la solicitud antes de navegar; aquí solo hidratamos el formulario con los
  // datos del viaje. La caché ['ride', id] la pobló usePauseForEdit.onSuccess.
  const editQuery = useRide(rideId ?? null);
  const existingRide = editQuery.ride;
  const editAlreadyPublished = Boolean(isEditing && existingRide
    && (existingRide.status !== 'searching' || !existingRide.paused));
  const allowExit = manualExit || editAlreadyPublished;
  const didInitEdit = useRef(false);
  useEffect(() => {
    if (!rideId || didInitEdit.current || !existingRide) return;
    didInitEdit.current = true;
    setOrigin(existingRide.origin);
    setDestination(existingRide.destination);
    setService(existingRide.service);
    setPayment(existingRide.payment);
    setFare(formatBolivianosInput(existingRide.fare));
    // existingRide viene de la caché; se hidrata una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, existingRide]);

  const originalTripIsInvalid = Boolean(
    isEditing &&
      existingRide &&
      (getBoliviaPlaceError(existingRide.origin) != null ||
        getBoliviaPlaceError(existingRide.destination) != null),
  );

  const requestEditExit = () => {
    setConfirmExit(true);
  };

  // Intercepta flecha, gesto y back de Android. Una solicitud pausada requiere
  // confirmar la cancelación antes de salir al inicio.
  usePreventRemove(isEditing && Boolean(existingRide) && !allowExit, () => {
    if (!editRide.isPending && !cancelRecoveryRide.isPending) requestEditExit();
  });

  useEffect(() => {
    if (!allowExit) return;
    const frame = requestAnimationFrame(() => {
      if (exitHome || existingRide?.status === 'cancelled') {
        router.dismissTo('/(app)/(tabs)');
      } else if ((exitAfterSave || editAlreadyPublished) && rideId) {
        router.replace({
          pathname: existingRide?.status === 'completed' ? '/booking/rating'
            : existingRide?.status === 'searching' ? '/booking/offers' : '/booking/trip',
          params: { rideId },
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [allowExit, exitAfterSave, exitHome, editAlreadyPublished, existingRide?.status, rideId, router]);

  const cancelRecoveryAndExit = () => {
    setConfirmExit(false);
    setConfirmRecoveryCancel(false);
    if (!rideId || cancelRecoveryRide.isPending) return;
    cancelRecoveryRide.mutate(rideId, {
      onSuccess: () => {
        queryClient.setQueryData(PASSENGER_ACTIVE_RIDE_KEY, null);
        useBookingStore.getState().resetTrip();
        setExitHome(true);
        setAllowExit(true);
      },
    });
  };

  const serviceAreaError = origin
    ? getBoliviaPlaceError(origin)
    : BOLIVIA_SERVICE_AREA_MESSAGE;
  const destinationAreaError = destination
    ? getBoliviaPlaceError(destination)
    : BOLIVIA_SERVICE_AREA_MESSAGE;
  const tripInServiceArea = serviceAreaError == null && destinationAreaError == null;
  const { route, isLoading: routeLoading, retry: retryRoute } = useRoute(
    tripInServiceArea ? origin : null,
    tripInServiceArea ? destination : null,
    service,
  );

  const region = useMemo<Region | undefined>(() => {
    if (!origin || !destination) return undefined;
    const a = origin.coordinates;
    const b = destination.coordinates;
    return {
      latitude: (a.latitude + b.latitude) / 2,
      longitude: (a.longitude + b.longitude) / 2,
      latitudeDelta: Math.max(Math.abs(a.latitude - b.latitude) * 1.8, 0.02),
      longitudeDelta: Math.max(Math.abs(a.longitude - b.longitude) * 1.8, 0.02),
    };
  }, [origin, destination]);

  // Para encuadrar la cámara: el trayecto real si existe, si no la recta entre
  // ambos puntos (así el mapa enmarca el viaje desde el primer instante).
  const fitCoordinates = useMemo<Coordinates[]>(() => {
    if (route && route.coordinates.length >= 2) return route.coordinates;
    if (origin && destination) return [origin.coordinates, destination.coordinates];
    return [];
  }, [route, origin, destination]);

  // Never present a straight line as a computed road route.
  const polylineCoordinates = route?.coordinates ?? [];

  // react-native-maps conserva internamente overlays nativos. Una clave basada
  // en ambos puntos fuerza a reemplazarlos al editar origen o destino, evitando
  // que se vea la ruta o los pins del trayecto anterior.
  const tripMapKey = origin && destination
    ? `${origin.coordinates.latitude},${origin.coordinates.longitude}:${destination.coordinates.latitude},${destination.coordinates.longitude}`
    : '';

  // Encuadra origen + destino dejando libre el área que tapa el bottom sheet.
  const fitToTrip = useCallback(
    (animated: boolean) => {
      if (!mapReady || mapSize.width <= 0 || mapSize.height <= 0 || fitCoordinates.length < 2) return;
      mapRef.current?.fitToCoordinates(fitCoordinates, {
        edgePadding: {
          top: Math.ceil(headerHeight + spacing.sm),
          right: FIT_SIDES,
          bottom: 24,
          left: FIT_SIDES,
        },
        animated,
      });
    },
    [fitCoordinates, mapReady, mapSize.width, mapSize.height, headerHeight],
  );

  // Reajusta la cámara cuando llega/cambia el trayecto o se mide el sheet.
  useEffect(() => {
    fitToTrip(false);
  }, [fitToTrip]);

  if (isEditing && editQuery.isLoading && !existingRide) {
    return (
      <SafeAreaView style={styles.root}>
        <FeedbackState loading title="Cargando tu solicitud…" />
        <Button title="Volver al inicio" variant="secondary" onPress={() => {
          setExitHome(true);
          setAllowExit(true);
        }} />
      </SafeAreaView>
    );
  }

  if (isEditing && editQuery.isError && !existingRide) {
    return (
      <SafeAreaView style={styles.root}>
        <FeedbackState
          icon="cloud-offline-outline"
          title="No pudimos cargar tu solicitud"
          message={getApiErrorMessage(editQuery.error)}
          actionLabel="Reintentar"
          onAction={() => void editQuery.refetch()}
        />
        <Button title="Volver al inicio" variant="secondary" onPress={() => {
          setExitHome(true);
          setAllowExit(true);
        }} />
        {cancelRecoveryRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(cancelRecoveryRide.error)}</Text>
        )}
        <View style={styles.recoveryAction}>
          <Button
            title="Cancelar solicitud y salir"
            variant="secondary"
            loading={cancelRecoveryRide.isPending}
            onPress={() => setConfirmRecoveryCancel(true)}
          />
        </View>
        <ConfirmDialog
          visible={confirmRecoveryCancel}
          icon="warning-outline"
          destructive
          title="¿Cancelar la solicitud?"
          message="La búsqueda se cerrará y volverás al inicio."
          confirmText="Sí, cancelar"
          cancelText="Seguir aquí"
          onConfirm={cancelRecoveryAndExit}
          onCancel={() => setConfirmRecoveryCancel(false)}
        />
      </SafeAreaView>
    );
  }

  if (!origin || !destination || !region) {
    return (
      <SafeAreaView style={[styles.root, styles.fallback]}>
        <Ionicons name="map-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.fallbackText}>Define el origen y el destino para continuar.</Text>
        <TouchableOpacity
          style={styles.fallbackButton}
          onPress={() =>
            router.replace({
              pathname: '/booking/destination',
              params: rideId ? { rideId } : {},
            })
          }
          accessibilityRole="button">
          <Text style={styles.fallbackButtonText}>Elegir destino</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const fareValue = Number(fare.replace(',', '.'));
  const fareIsValid = Number.isFinite(fareValue) && fareValue > 0;
  const unresolvedMapLabel = labelsError ? 'Dirección pendiente' : 'Obteniendo dirección…';
  const originMapLabel = isPlaceLabelResolved(origin)
    ? getPlaceStreetName(origin)
    : unresolvedMapLabel;
  const destinationMapLabel = isPlaceLabelResolved(destination)
    ? getPlaceStreetName(destination)
    : unresolvedMapLabel;
  const originMapLoading = labelsResolving && !isPlaceLabelResolved(origin);
  const destinationMapLoading = labelsResolving && !isPlaceLabelResolved(destination);

  const searchOffers = () => {
    if (!tripInServiceArea || !labelsReady || !fareIsValid || createRide.isPending) return;
    createRide.mutate({ origin, destination, service, payment, fare: fareValue }, {
      onSuccess: (ride) => router.replace({
        pathname: ride.status === 'searching' ? '/booking/offers' : '/booking/trip',
        params: { rideId: ride.id },
      }),
    });
  };

  const saveEdit = () => {
    if (!rideId || !tripInServiceArea || !labelsReady || !fareIsValid || editRide.isPending) {
      return;
    }
    editRide.mutate(
      { rideId, input: { origin, destination, service, payment, fare: fareValue } },
      {
        onSuccess: () => {
          setExitAfterSave(true);
          setAllowExit(true);
        },
      },
    );
  };

  const editOrigin = () => {
    if (editRide.isPending) return;
    router.push({
      pathname: '/booking/pick-on-map',
      params: { target: 'origin', ...(rideId ? { rideId } : {}) },
    });
  };

  const editDestination = () => {
    if (editRide.isPending) return;
    router.push({
      pathname: '/booking/destination',
      params: rideId ? { rideId } : {},
    });
  };

  return (
    <View style={styles.root}>
      {isFocused && !allowExit && (
        <View style={[styles.mapViewport, { bottom: sheetHeight }]}
          onLayout={({ nativeEvent: { layout } }) => setMapSize((current) =>
            current.width === layout.width && current.height === layout.height
              ? current : { width: layout.width, height: layout.height })}>
        <MapView
          key={tripMapKey}
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          showsBuildings={false}
          showsIndoors={false}
          showsIndoorLevelPicker={false}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          customMapStyle={estiloMapa}
          userInterfaceStyle={modoMapa}
          pitchEnabled={false}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          zoomTapEnabled={false}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          onRegionChangeComplete={actualizarRumbo}
          onMapReady={() => { setMapReady(true); fitToTrip(false); }}>
          <RoutePinMarker
            key={`origin-${tripMapKey}`}
            kind="A"
            coordinate={origin.coordinates}
            ruta={fitCoordinates}
            rumboMapa={rumboMapa}
            zoomMapa={zoomMapa}
            label={`Origen: ${originMapLabel}`}
            showTooltip={false}
            loading={originMapLoading}
            zIndex={20}
            onPress={editOrigin}
          />
          <RoutePinMarker
            key={`destination-${tripMapKey}`}
            kind="B"
            coordinate={destination.coordinates}
            ruta={fitCoordinates}
            rumboMapa={rumboMapa}
            zoomMapa={zoomMapa}
            label={`Destino: ${destinationMapLabel}`}
            showTooltip={false}
            loading={destinationMapLoading}
            zIndex={21}
            onPress={editDestination}
          />
          <RoutePolyline coordinates={polylineCoordinates} />
        </MapView>
        </View>
      )}

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none"
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
        <View style={styles.topLeft}>
          <TouchableOpacity
            style={styles.back}
            onPress={() => {
              if (isEditing) {
                requestEditExit();
                return;
              }
              useBookingStore.getState().resetTrip();
              setExitHome(true);
              setAllowExit(true);
            }}
            disabled={editRide.isPending}
            accessibilityRole="button"
            accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.back}
            onPress={() => setShowPlaces((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ selected: showPlaces }}
            accessibilityLabel={showPlaces ? 'Ocultar nombres de lugares' : 'Mostrar nombres de lugares'}>
            <Ionicons
              name={showPlaces ? 'business' : 'business-outline'}
              size={22}
              color={showPlaces ? colors.primary : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View
        style={[
          styles.sheetAvoider,
          { transform: [{ translateY: -keyboardOffset }] },
        ]}
        pointerEvents="box-none">
        <SafeAreaView
          style={styles.sheet}
          edges={['bottom']}
          onLayout={(e) => {
            if (keyboardHeight === 0) setSheetHeight(e.nativeEvent.layout.height);
          }}>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            bounces={false}>
            <View style={[styles.estimate, { minHeight: 32 * fontScale }]}>
                <Ionicons name="navigate" size={16} color={colors.primary} />
                <Text style={styles.estimateText}>
                  {routeLoading ? 'Actualizando ruta…' : route
                    ? `${formatDistance(route.distanceMeters)} · ${formatDuration(route.durationSeconds)}`
                    : 'No pudimos calcular la ruta'}
                </Text>
              </View>
            {!route && !routeLoading && <Button title="Reintentar ruta" variant="secondary" onPress={retryRoute} />}

        <Text style={styles.fieldLabel}>Tipo de servicio</Text>
        <ServiceTypeSelector value={service} onChange={setService} />

        <Text style={styles.fieldLabel}>Método de pago</Text>
        <SelectableOptionCards options={PAYMENTS} value={payment} onChange={setPayment} />

        <Text style={styles.fieldLabel}>Tu oferta</Text>
        <View style={styles.fareRow}>
          <Text style={styles.fareCurrency}>Bs</Text>
          <TextInput
            value={fare}
            onChangeText={setFare}
            placeholder="30"
            placeholderTextColor={colors.placeholder}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={9}
            onBlur={() => setKeyboardOffset(0)}
            style={styles.fareInput}
            accessibilityLabel="Monto de tu oferta en bolivianos"
          />
        </View>

        {createRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(createRide.error)}</Text>
        )}
        {editRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(editRide.error)}</Text>
        )}
        {labelsResolving && (
          <Text style={styles.locationStatus} accessibilityLiveRegion="polite">
            Obteniendo los nombres del origen y destino…
          </Text>
        )}
        {labelsError && !labelsResolving && (
          <View style={styles.locationError}>
            <Text style={styles.error} accessibilityRole="alert">
              {labelsError}
            </Text>
            <Button title="Reintentar direcciones" variant="secondary" onPress={retryLabels} />
          </View>
        )}
        {!tripInServiceArea && (
          <Text style={styles.error} accessibilityRole="alert">
            {serviceAreaError ?? destinationAreaError} Corrige el origen o el destino para continuar.
          </Text>
        )}
        {originalTripIsInvalid && (
          <Button
            title="Cancelar solicitud y salir"
            variant="secondary"
            loading={cancelRecoveryRide.isPending}
            onPress={() => setConfirmRecoveryCancel(true)}
          />
        )}
        {cancelRecoveryRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(cancelRecoveryRide.error)}</Text>
        )}
        <MotorcycleRouteNotice service={service} />
          </ScrollView>

          <View style={styles.sheetFooter}>
            <Button
              title={isEditing ? 'Guardar cambios' : 'Buscar ofertas'}
              trailingIcon="arrow-forward"
              loading={createRide.isPending || editRide.isPending || labelsResolving}
              loadingLabel={labelsResolving ? 'Obteniendo direcciones…' : isEditing ? 'Guardando…' : 'Buscando ofertas…'}
              disabled={
                !tripInServiceArea ||
                !labelsReady ||
                !fareIsValid ||
                createRide.isPending ||
                editRide.isPending
              }
              onPress={isEditing ? saveEdit : searchOffers}
            />
          </View>
        </SafeAreaView>
      </View>

      <ConfirmDialog
        visible={confirmExit}
        icon="warning-outline"
        destructive
        title="¿Cancelar la solicitud?"
        message="La búsqueda se cancelará y volverás al inicio para definir un nuevo punto de partida."
        confirmText="Sí, cancelar"
        cancelText="Seguir configurando"
        onConfirm={cancelRecoveryAndExit}
        onCancel={() => setConfirmExit(false)}
      />
      <ConfirmDialog
        visible={confirmRecoveryCancel}
        icon="warning-outline"
        destructive
        title="¿Cancelar la solicitud?"
        message="Esta solicitud usa una ubicación fuera de cobertura. Puedes corregirla o cancelarla para volver al inicio."
        confirmText="Sí, cancelar"
        cancelText="Corregir ubicación"
        onConfirm={cancelRecoveryAndExit}
        onCancel={() => setConfirmRecoveryCancel(false)}
      />
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapViewport: { position: 'absolute', top: 0, left: 0, right: 0 },
  fallback: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  fallbackText: { color: colors.textSecondary, fontSize: fontSize.md, textAlign: 'center' },
  fallbackButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  fallbackButtonText: { color: colors.textOnPrimary, fontWeight: fontWeight.semibold },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  topLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  back: {
    width: 48,
    minHeight: 48,
    paddingVertical: spacing.sm,
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
  sheetAvoider: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
    height: '54%',
  },
  sheetScroll: { flex: 1 },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  sheetFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },

  estimate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  estimateText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.text },

  fieldLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bordeControl,
    backgroundColor: colors.surface,
  },
  fareCurrency: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  fareInput: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, padding: 0 },

  locationStatus: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
  locationError: { gap: spacing.xs },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  recoveryAction: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
