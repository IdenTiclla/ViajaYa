/**
 * Configurar viaje — paso final del flujo: muestra origen y destino marcados en
 * el mapa, unidos por el trayecto real por calles (Google Routes API), y permite
 * elegir servicio, proponer una oferta y buscar ofertas de conductores.
 *
 * Si el cálculo del trayecto falla (key restringida, sin red), cae a una línea
 * recta entre ambos puntos.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRoute } from '@/features/booking/application/useRoute';
import { ridesRepository } from '@/features/booking/data/ridesRepository';
import {
  BOLIVIA_SERVICE_AREA_MESSAGE,
  getBoliviaPlaceError,
} from '@/features/booking/domain/bolivia';
import { getPlaceStreetName } from '@/features/booking/domain/placeLabels';
import { SERVICE_OPTIONS } from '@/features/booking/domain/serviceCatalog';
import type { Coordinates, PaymentMethod } from '@/features/booking/domain/types';
import { useCancelRide, useEditRide } from '@/features/rides/application/useRideMutations';
import { formatBolivianosInput } from '@/features/rides/domain/money';
import {
  PASSENGER_ACTIVE_RIDE_KEY,
  useRide,
} from '@/features/rides/application/useRides';
import { declutteredMapStyle } from '@/features/booking/presentation/mapStyle';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';
import { Button, ConfirmDialog, FeedbackState } from '@/shared/components';

const PAYMENTS: { id: PaymentMethod; label: string; icon: 'qr-code' | 'cash' }[] = [
  { id: 'qr', label: 'QR', icon: 'qr-code' },
  { id: 'cash', label: 'Efectivo', icon: 'cash' },
];

// Márgenes del encuadre: arriba y a los lados dejan sitio a los controles de los pines;
// abajo es dinámico (alto real del bottom sheet) para que ambos puntos queden en
// el área visible.
const FIT_TOP = 170;
const FIT_SIDES = 60;
const FIT_CONTROL_CLEARANCE = 100;
const MIN_KEYBOARD_TRANSLATION = 280;
const EDIT_BUTTON_WIDTH = 56;
const EDIT_BUTTON_HEIGHT = 22;
const EDIT_CONTROLS_HEIGHT = 74;
const EDIT_CONTROLS_GAP = 12;
const EDIT_PIN_RADIUS = 9;

type ProjectedPoint = { x: number; y: number };

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function ConfigureTripScreen() {
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
  const mapRef = useRef<MapView>(null);
  const projectionRequestRef = useRef(0);
  const projectionFrameRef = useRef<number | null>(null);
  const projectionInFlightRef = useRef(false);
  const projectionQueuedRef = useRef(false);
  const [projectedPoints, setProjectedPoints] = useState<{
    origin: ProjectedPoint;
    destination: ProjectedPoint;
  } | null>(null);
  const queryClient = useQueryClient();
  const editRide = useEditRide();
  const cancelRecoveryRide = useCancelRide();
  // Alto real del bottom sheet, para encuadrar los puntos por encima de él.
  const [sheetHeight, setSheetHeight] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  // Mostrar/ocultar etiquetas de lugares (el usuario lo controla con el toggle).
  const [showPlaces, setShowPlaces] = useState(true);
  const [confirmExit, setConfirmExit] = useState(false);
  const [allowExit, setAllowExit] = useState(false);
  const [exitAfterSave, setExitAfterSave] = useState(false);
  const [exitHome, setExitHome] = useState(false);
  const [confirmRecoveryCancel, setConfirmRecoveryCancel] = useState(false);

  const syncEditControls = useCallback(async () => {
    if (projectionInFlightRef.current) {
      projectionQueuedRef.current = true;
      return;
    }
    projectionInFlightRef.current = true;
    try {
      do {
        projectionQueuedRef.current = false;
        const map = mapRef.current;
        if (!map || !origin || !destination) return;
        const requestId = ++projectionRequestRef.current;
        try {
          const [originPoint, destinationPoint] = await Promise.all([
            map.pointForCoordinate(origin.coordinates),
            map.pointForCoordinate(destination.coordinates),
          ]);
          if (requestId === projectionRequestRef.current) {
            setProjectedPoints({ origin: originPoint, destination: destinationPoint });
          }
        } catch {
          // Durante un cambio de cámara Android puede rechazar una proyección
          // intermedia. Conservamos la última posición y reintentamos al frame siguiente.
        }
      } while (projectionQueuedRef.current);
    } finally {
      projectionInFlightRef.current = false;
    }
  }, [destination, origin]);

  const scheduleEditControlsSync = useCallback(() => {
    if (projectionFrameRef.current != null) return;
    projectionFrameRef.current = requestAnimationFrame(() => {
      projectionFrameRef.current = null;
      void syncEditControls();
    });
  }, [syncEditControls]);

  useEffect(() => {
    if (isFocused) return;
    projectionRequestRef.current += 1;
    projectionQueuedRef.current = false;
    if (projectionFrameRef.current != null) {
      cancelAnimationFrame(projectionFrameRef.current);
      projectionFrameRef.current = null;
    }
  }, [isFocused]);

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

  const createRide = useMutation({
    mutationFn: ridesRepository.create,
    onSuccess: (ride) => {
      // Refresca los recientes (este destino pasa a estar entre ellos).
      void queryClient.invalidateQueries({ queryKey: ['recent-destinations'] });
      // La creación devuelve un resumen corto; el layout obtiene el Ride completo
      // y abre el socket único mediante el endpoint de viaje activo.
      void queryClient.invalidateQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY });
      // No dejamos el formulario de creación debajo de una negociación activa:
      // el regreso solo se hace mediante Modificar o Cancelar.
      router.replace({ pathname: '/booking/offers', params: { rideId: ride.id } });
    },
  });

  // Modo edición (Modificar solicitud): el llamador (Offers/Searching) ya pausó
  // la solicitud antes de navegar; aquí solo hidratamos el formulario con los
  // datos del viaje. La caché ['ride', id] la pobló usePauseForEdit.onSuccess.
  const editQuery = useRide(rideId ?? null);
  const existingRide = editQuery.ride;
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
  usePreventRemove(isEditing && !allowExit, () => {
    if (!editRide.isPending && !cancelRecoveryRide.isPending) requestEditExit();
  });

  useEffect(() => {
    if (allowExit && exitHome) {
      router.replace('/(app)/(tabs)');
    } else if (allowExit && exitAfterSave && rideId) {
      router.replace({ pathname: '/booking/offers', params: { rideId } });
    }
  }, [allowExit, exitAfterSave, exitHome, rideId, router]);

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
  const { route, isLoading: routeLoading } = useRoute(
    tripInServiceArea ? origin : null,
    tripInServiceArea ? destination : null,
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
    if (!routeLoading && route?.coordinates.length) return route.coordinates;
    if (origin && destination) return [origin.coordinates, destination.coordinates];
    return [];
  }, [route, routeLoading, origin, destination]);

  // Para dibujar: la recta solo aparece como fallback cuando el cálculo del
  // trayecto terminó sin ruta; mientras carga no se dibuja, para evitar el
  // "salto" visual de recta → trayecto por calles.
  const polylineCoordinates = useMemo<Coordinates[]>(() => {
    if (routeLoading) return [];
    if (route?.coordinates.length) return route.coordinates;
    if (origin && destination) return [origin.coordinates, destination.coordinates];
    return [];
  }, [route, routeLoading, origin, destination]);

  // Coloca los controles en el lado vertical opuesto al tramo más cercano.
  // Si la ruta sale/llega hacia arriba, el control queda debajo del pin.
  const originEditPlacement = useMemo(() => {
    const nextPoint = polylineCoordinates[1] ?? destination?.coordinates;
    if (!nextPoint || !origin) return 'above' as const;
    const latitudeDelta = nextPoint.latitude - origin.coordinates.latitude;
    const longitudeDelta = nextPoint.longitude - origin.coordinates.longitude;
    return Math.abs(latitudeDelta) > Math.abs(longitudeDelta) && latitudeDelta > 0
      ? 'below'
      : 'above';
  }, [destination, origin, polylineCoordinates]);
  const destinationEditPlacement = useMemo(() => {
    const previousPoint =
      polylineCoordinates[polylineCoordinates.length - 2] ?? origin?.coordinates;
    if (!previousPoint || !destination) return 'above' as const;
    const latitudeDelta = previousPoint.latitude - destination.coordinates.latitude;
    const longitudeDelta = previousPoint.longitude - destination.coordinates.longitude;
    return Math.abs(latitudeDelta) > Math.abs(longitudeDelta) && latitudeDelta > 0
      ? 'below'
      : 'above';
  }, [destination, origin, polylineCoordinates]);
  const needsBottomControlSpace =
    originEditPlacement === 'below' || destinationEditPlacement === 'below';

  // react-native-maps conserva internamente overlays nativos. Una clave basada
  // en ambos puntos fuerza a reemplazarlos al editar origen o destino, evitando
  // que se vea la ruta o los pins del trayecto anterior.
  const tripMapKey = origin && destination
    ? `${origin.coordinates.latitude},${origin.coordinates.longitude}:${destination.coordinates.latitude},${destination.coordinates.longitude}`
    : '';

  // Encuadra origen + destino dejando libre el área que tapa el bottom sheet.
  const fitToTrip = useCallback(
    (animated: boolean) => {
      if (fitCoordinates.length < 2) return;
      mapRef.current?.fitToCoordinates(fitCoordinates, {
        edgePadding: {
          top: FIT_TOP,
          right: FIT_SIDES,
          bottom: sheetHeight + 24 + (needsBottomControlSpace ? FIT_CONTROL_CLEARANCE : 0),
          left: FIT_SIDES,
        },
        animated,
      });
    },
    [fitCoordinates, needsBottomControlSpace, sheetHeight],
  );

  // Reajusta la cámara cuando llega/cambia el trayecto o se mide el sheet.
  useEffect(() => {
    fitToTrip(true);
  }, [fitToTrip]);

  if (isEditing && editQuery.isLoading && !existingRide) {
    return (
      <SafeAreaView style={styles.root}>
        <FeedbackState loading title="Cargando tu solicitud…" />
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

  const searchOffers = () => {
    if (!tripInServiceArea || !fareIsValid || createRide.isPending) return;
    createRide.mutate({ origin, destination, service, payment, fare: fareValue });
  };

  const saveEdit = () => {
    if (!rideId || !tripInServiceArea || !fareIsValid || editRide.isPending) return;
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
      {isFocused && (
        <MapView
          key={tripMapKey}
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          customMapStyle={showPlaces ? [] : declutteredMapStyle}
          onMapReady={() => {
            fitToTrip(false);
            scheduleEditControlsSync();
          }}
          onRegionChange={scheduleEditControlsSync}
          onRegionChangeComplete={scheduleEditControlsSync}>
          <RoutePinMarker
            key={`origin-${tripMapKey}`}
            kind="A"
            coordinate={origin.coordinates}
            label={`Origen: ${getPlaceStreetName(origin)}`}
            showEditControl
            editControlPlacement={originEditPlacement}
          />
          <RoutePinMarker
            key={`destination-${tripMapKey}`}
            kind="B"
            coordinate={destination.coordinates}
            label={`Destino: ${getPlaceStreetName(destination)}`}
            showEditControl
            editControlPlacement={destinationEditPlacement}
          />
          {polylineCoordinates.length >= 2 && (
            <>
              {/* Contorno blanco para que la ruta resalte sobre calles y etiquetas. */}
              <Polyline
                key={`route-outline-${tripMapKey}`}
                coordinates={polylineCoordinates}
                strokeColor={colors.surface}
                strokeWidth={9}
                zIndex={1}
              />
              <Polyline
                key={`route-${tripMapKey}`}
                coordinates={polylineCoordinates}
                strokeColor={colors.primary}
                strokeWidth={5}
                zIndex={2}
              />
            </>
          )}
        </MapView>
      )}

      {isFocused && projectedPoints && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <PinEditHitTarget
            kind="A"
            point={projectedPoints.origin}
            placement={originEditPlacement}
            disabled={editRide.isPending}
            onEdit={editOrigin}
          />
          <PinEditHitTarget
            kind="B"
            point={projectedPoints.destination}
            placement={destinationEditPlacement}
            disabled={editRide.isPending}
            onEdit={editDestination}
          />
        </View>
      )}

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <View style={styles.topLeft}>
          <TouchableOpacity
            style={styles.back}
            onPress={() => {
              if (isEditing) {
                requestEditExit();
                return;
              }
              useBookingStore.getState().resetTrip();
              router.replace('/(app)/(tabs)');
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
          style={[styles.sheet, keyboardHeight === 0 && styles.sheetResting]}
          edges={['bottom']}
          onLayout={(e) => {
            if (keyboardHeight === 0) setSheetHeight(e.nativeEvent.layout.height);
          }}>
          <View style={styles.sheetContent}>
            {route && (
              <View style={styles.estimate}>
                <Ionicons name="navigate" size={16} color={colors.primary} />
                <Text style={styles.estimateText}>
                  {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
                </Text>
              </View>
            )}

        <Text style={styles.fieldLabel}>Tipo de servicio</Text>
        <View style={styles.serviceOptions}>
          {SERVICE_OPTIONS.map((s) => {
            const active = service === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.serviceOption, active && styles.serviceChipActive]}
                onPress={() => setService(s.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={s.label}>
                <Ionicons
                  name={s.icon}
                  size={20}
                  color={active ? colors.textOnPrimary : colors.text}
                />
                <Text
                  numberOfLines={2}
                  style={[
                    styles.serviceOptionText,
                    active && styles.serviceChipTextActive,
                  ]}>
                  {s.shortLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Método de pago</Text>
        <View style={styles.services}>
          {PAYMENTS.map((p) => {
            const active = payment === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.serviceChip, active && styles.serviceChipActive]}
                onPress={() => setPayment(p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Pagar con ${p.label}`}>
                <Ionicons
                  name={p.icon}
                  size={20}
                  color={active ? colors.textOnPrimary : colors.text}
                />
                <Text style={[styles.serviceChipText, active && styles.serviceChipTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

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

        <TouchableOpacity
          style={[
            styles.cta,
            (!tripInServiceArea ||
              !fareIsValid ||
              createRide.isPending ||
              editRide.isPending) &&
              styles.ctaDisabled,
          ]}
          disabled={
            !tripInServiceArea || !fareIsValid || createRide.isPending || editRide.isPending
          }
          onPress={isEditing ? saveEdit : searchOffers}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Guardar cambios' : 'Buscar ofertas'}>
          {createRide.isPending || editRide.isPending ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.ctaText}>{isEditing ? 'Guardar cambios' : 'Buscar Ofertas'}</Text>
          )}
        </TouchableOpacity>
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

function PinEditHitTarget({
  kind,
  point,
  placement,
  disabled,
  onEdit,
}: {
  kind: 'A' | 'B';
  point: ProjectedPoint;
  placement: 'above' | 'below';
  disabled: boolean;
  onEdit: () => void;
}) {
  const left = point.x - EDIT_BUTTON_WIDTH / 2;
  const top =
    placement === 'above'
      ? point.y - EDIT_CONTROLS_HEIGHT - EDIT_CONTROLS_GAP - EDIT_PIN_RADIUS
      : point.y + EDIT_CONTROLS_GAP + EDIT_PIN_RADIUS;

  return (
    <TouchableOpacity
      style={[styles.pinEditHitTarget, { left, top }]}
      onPress={onEdit}
      disabled={disabled}
      activeOpacity={1}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Editar ${kind === 'A' ? 'origen' : 'destino'}`}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
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
  topLeft: { alignItems: 'flex-start', gap: spacing.xs },
  back: {
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
  pinEditHitTarget: {
    position: 'absolute',
    width: EDIT_BUTTON_WIDTH,
    height: EDIT_BUTTON_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
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
  },
  sheetResting: { maxHeight: '48%' },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
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
  services: { flexDirection: 'row', gap: spacing.md },
  serviceOptions: { flexDirection: 'row', gap: spacing.sm },
  serviceOption: {
    flex: 1,
    minWidth: 0,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  serviceOptionText: {
    fontSize: fontSize.xs,
    lineHeight: 15,
    fontWeight: fontWeight.medium,
    color: colors.text,
    textAlign: 'center',
  },
  serviceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  serviceChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  serviceChipText: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  serviceChipTextActive: { color: colors.textOnPrimary },

  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fareCurrency: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  fareInput: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, padding: 0 },

  cta: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  recoveryAction: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
