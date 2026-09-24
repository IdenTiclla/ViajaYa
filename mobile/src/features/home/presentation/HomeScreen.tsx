import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Details, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useEstiloMapa } from '@/features/booking/presentation/mapStyle';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import { useRegionPlace } from '@/features/booking/application/useRegionPlace';
import {
  BOLIVIA_NORTH_EAST,
  BOLIVIA_SERVICE_AREA_MESSAGE,
  BOLIVIA_SOUTH_WEST,
  getBoliviaPlaceError,
  isCoordinatesInBolivia,
  isPlaceInBolivia,
} from '@/features/booking/domain/bolivia';
import {
  getPlaceStreetName,
  isPlaceLabelResolved,
} from '@/features/booking/domain/placeLabels';
import type { Coordinates, Place } from '@/features/booking/domain/types';
import { CenterPin } from '@/features/booking/presentation/CenterPin';
import { ServiceTypeSelector } from '@/features/booking/presentation/ServiceTypeSelector';
import { confirmarRecuperacion } from '@/features/home/application/confirmarRecuperacion';
import { useCurrentLocation } from '@/features/home/application/useCurrentLocation';
import {
  PASSENGER_ACTIVE_RIDE_KEY,
  usePendingRatingRide,
  usePassengerActiveRide,
} from '@/features/rides/application/useRides';
import type { Ride } from '@/features/rides/domain/types';
import { useAuthStore } from '@/store/authStore';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function firstName(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? 'viajero';
}

function coordenadasCasiIguales(a: Coordinates, b: Coordinates): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 0.00001 &&
    Math.abs(a.longitude - b.longitude) < 0.00001
  );
}

export function HomeScreen() {
  const { colors, styles } = useEstilos(crearEstilos);
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  // Mantiene visibles saludo, busqueda y servicios sin cubrir innecesariamente el mapa.
  const availableHeight = Math.max(320, screenHeight - insets.top - spacing.md);
  const sheetHeight = Math.min(
    Math.max(Math.round(screenHeight * 0.66), 420),
    570,
    availableHeight,
  );
  const sheetPeek = Math.min(236 + Math.min(insets.bottom, spacing.sm), sheetHeight);
  const maxTranslate = Math.max(0, sheetHeight - sheetPeek);
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    ride: activeRide,
    isLoading: activeRideLoading,
    isFetching: activeRideFetching,
    isError: activeRideError,
    error: activeRideErrorValue,
    refetch: refetchActiveRide,
  } = usePassengerActiveRide();
  const {
    ride: pendingRatingRide,
    isLoading: pendingRatingLoading,
    isFetching: pendingRatingFetching,
    isError: pendingRatingError,
    error: pendingRatingErrorValue,
    refetch: refetchPendingRating,
  } = usePendingRatingRide();
  const { status, coordinates, canAskAgain, isEstimated, retry } = useCurrentLocation();
  const mapRef = useRef<MapView>(null);
  const { estiloMapa, modoMapa } = useEstiloMapa(false);
  const mapReady = useRef(false);
  const pendingAutomaticRegion = useRef<Region | null>(null);
  const lastLocationRefresh = useRef(0);
  const seeded = useRef(false);
  const automaticOriginCoordinates = useRef<Coordinates | null>(null);
  const originAdjustedByUser = useRef(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryFailure, setRecoveryFailure] = useState<string | null>(null);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [originManuallyAdjusted, setOriginManuallyAdjusted] = useState(false);
  const recoveryReadyRef = useRef(false);

  const origin = useBookingStore((s) => s.origin);
  const setOrigin = useBookingStore((s) => s.setOrigin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const service = useBookingStore((s) => s.service);
  const setService = useBookingStore((s) => s.setService);
  const { places: recentPlaces } = useRecentDestinations();
  const validRecentPlaces = useMemo(
    () => recentPlaces.filter(isPlaceInBolivia),
    [recentPlaces],
  );
  // Al terminar de mover el mapa, el centro pasa a ser el origen.
  const {
    onRegionChangeComplete: handleRegionChange,
    isResolving: originResolving,
    resolutionFailed: originResolutionFailed,
    cancelPendingResolution: cancelOriginResolution,
  } = useRegionPlace(setOrigin);
  const originPrefix = isEstimated && !originManuallyAdjusted ? 'Origen aproximado' : 'Origen';
  const originPinLabel = originResolving
    ? `${originPrefix}: Obteniendo lugar…`
    : origin && isPlaceLabelResolved(origin)
      ? `${originPrefix}: ${getPlaceStreetName(origin)}`
      : originResolutionFailed
        ? `${originPrefix}: Dirección pendiente`
        : `${originPrefix}: ${origin ? 'Obteniendo dirección…' : 'Mueve el mapa'}`;

  // Empieza colapsado (mapa visible). translateY: 0 = expandido, MAX = colapsado.
  // `useState` con inicializador perezoso crea valores estables; el offset del
  // arrastre lo lleva el propio Animated.Value (extractOffset/flattenOffset),
  // así no hace falta una ref accedida durante el render.
  const [translateY] = useState(() => new Animated.Value(maxTranslate));

  useEffect(() => {
    translateY.setValue(maxTranslate);
  }, [maxTranslate, translateY]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Solo toma el gesto si es un arrastre vertical claro (deja pasar taps).
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        // Conserva la posición actual como base del arrastre.
        onPanResponderGrant: () => translateY.extractOffset(),
        onPanResponderMove: (_, g) => translateY.setValue(g.dy),
        onPanResponderRelease: (_, g) => {
          translateY.flattenOffset();
          translateY.stopAnimation((value) => {
            const collapsed = maxTranslate;
            // Snap a la posición más cercana, o según la velocidad del gesto.
            const target =
              g.vy > 0.5
                ? collapsed
                : g.vy < -0.5
                  ? 0
                  : value > collapsed / 2
                    ? collapsed
                    : 0;
            Animated.spring(translateY, {
              toValue: target,
              useNativeDriver: false,
              bounciness: 2,
            }).start();
          });
        },
      }),
    [maxTranslate, translateY],
  );

  const region = useMemo<Region | undefined>(() => {
    if (!coordinates || !isCoordinatesInBolivia(coordinates)) return undefined;
    return {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [coordinates]);

  // Siembra el origen con la ubicación disponible. Si empezó con una posición
  // estimada, la reemplaza por la posición fresca salvo que el pasajero haya movido
  // el mapa o elegido otro origen mientras tanto.
  useEffect(() => {
    if (!region) return;
    const nextCoordinates = { latitude: region.latitude, longitude: region.longitude };

    if (!seeded.current) {
      seeded.current = true;
      automaticOriginCoordinates.current = nextCoordinates;
      handleRegionChange(region);
      return;
    }

    if (originAdjustedByUser.current) return;
    const previousCoordinates = automaticOriginCoordinates.current;
    if (
      previousCoordinates &&
      origin &&
      !coordenadasCasiIguales(origin.coordinates, previousCoordinates)
    ) {
      originAdjustedByUser.current = true;
      setOriginManuallyAdjusted(true);
      cancelOriginResolution();
      return;
    }
    if (previousCoordinates && coordenadasCasiIguales(previousCoordinates, nextCoordinates)) return;

    if (!mapReady.current) {
      pendingAutomaticRegion.current = region;
      return;
    }
    pendingAutomaticRegion.current = null;
    automaticOriginCoordinates.current = nextCoordinates;
    mapRef.current?.animateToRegion(region, 400);
    handleRegionChange(region);
  }, [cancelOriginResolution, handleRegionChange, origin, region]);

  // Cada entrada a Home confirma primero el estado autoritativo. React Query puede
  // conservar SEARCHING durante 30 s; navegar antes de este refetch revive viajes
  // que el pasajero acaba de cancelar.
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      recoveryReadyRef.current = false;
      setRecoveryReady(false);
      setRecoveryFailure(null);

      const recover = async () => {
        try {
          await confirmarRecuperacion(refetchActiveRide, refetchPendingRating);
        } catch (error) {
          if (focused) {
            setRecoveryFailure(getApiErrorMessage(
              error,
              error instanceof Error ? error.message : undefined,
            ));
          }
        } finally {
          if (focused) {
            recoveryReadyRef.current = true;
            setRecoveryReady(true);
          }
        }
      };

      void recover();
      return () => {
        focused = false;
        recoveryReadyRef.current = false;
      };
    // El contador fuerza otra verificación al pulsar Reintentar con el mismo foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recoveryAttempt, refetchActiveRide, refetchPendingRating]),
  );

  // El tab permanece montado: al volver después de un tiempo actualizamos el
  // GPS para que "centrar" no use una posición antigua. No sobrescribimos el
  // origen que el pasajero haya ajustado manualmente.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'granted') return;
      const now = Date.now();
      if (lastLocationRefresh.current === 0) {
        lastLocationRefresh.current = now;
        return;
      }
      if (now - lastLocationRefresh.current < 60_000) return;
      lastLocationRefresh.current = now;
      retry();
    }, [retry, status]),
  );

  // Recupera el punto exacto del flujo una vez terminada la verificacion fresca.
  // El foco evita navegar desde el Home que permanece montado debajo del stack.
  useFocusEffect(
    useCallback(() => {
      if (
        !recoveryReadyRef.current ||
        !recoveryReady ||
        recoveryFailure ||
        activeRideLoading ||
        activeRideFetching ||
        activeRideError
      ) {
        return;
      }

      if (activeRide) {
        if (activeRide.status === 'cancelled') {
          queryClient.setQueryData<Ride | null>(PASSENGER_ACTIVE_RIDE_KEY, (current) =>
            current?.id === activeRide.id ? null : current,
          );
        } else if (activeRide.status === 'completed') {
          router.replace({ pathname: '/booking/rating', params: { rideId: activeRide.id } });
        } else if (activeRide.paused) {
          router.replace({ pathname: '/booking/configure', params: { rideId: activeRide.id } });
        } else if (activeRide.status === 'searching') {
          router.replace({ pathname: '/booking/offers', params: { rideId: activeRide.id } });
        } else {
          router.replace({ pathname: '/booking/trip', params: { rideId: activeRide.id } });
        }
        return;
      }

      // Un pendiente solo puede ganar cuando el endpoint activo confirmó que no
      // hay viaje vigente. Durante carga/refetch/error se conserva la prioridad.
      if (pendingRatingLoading || pendingRatingFetching || pendingRatingError) return;

      if (pendingRatingRide) {
        router.replace({
          pathname: '/booking/rating',
          params: { rideId: pendingRatingRide.id },
        });
      }
    }, [
      activeRide,
      activeRideError,
      activeRideFetching,
      activeRideLoading,
      pendingRatingError,
      pendingRatingFetching,
      pendingRatingLoading,
      pendingRatingRide,
      queryClient,
      recoveryReady,
      recoveryFailure,
      router,
    ]),
  );

  const recenter = () => {
    if (!region) return;
    originAdjustedByUser.current = false;
    setOriginManuallyAdjusted(false);
    if (!mapReady.current) {
      pendingAutomaticRegion.current = region;
      return;
    }
    pendingAutomaticRegion.current = null;
    automaticOriginCoordinates.current = { latitude: region.latitude, longitude: region.longitude };
    mapRef.current?.animateToRegion(region, 500);
    handleRegionChange(region);
  };

  const handleMapRegionChange = (nextRegion: Region, details: Details) => {
    if (details.isGesture) {
      originAdjustedByUser.current = true;
      pendingAutomaticRegion.current = null;
      setOriginManuallyAdjusted(true);
      handleRegionChange(nextRegion);
      return;
    }
    const automaticCoordinates = automaticOriginCoordinates.current;
    if (!originAdjustedByUser.current) {
      // El centrado automático ya se envía explícitamente a handleRegionChange.
      // Android vuelve a notificarlo con unos decimales distintos; ignoramos ese
      // eco para que no sustituya el origen por otro provisional.
      return;
    }
    if (automaticCoordinates && coordenadasCasiIguales(nextRegion, automaticCoordinates)) return;
    handleRegionChange(nextRegion);
  };

  const requestValidOrigin = (): boolean => {
    if (origin && isPlaceInBolivia(origin)) return true;

    Alert.alert(
      'Define un origen en Bolivia',
      origin
        ? (getBoliviaPlaceError(origin) ?? BOLIVIA_SERVICE_AREA_MESSAGE)
        : 'Necesitamos un punto de partida antes de elegir el destino.',
      [
        { text: 'Ahora no', style: 'cancel' },
        {
          text: 'Elegir en el mapa',
          onPress: () =>
            router.push({ pathname: '/booking/pick-on-map', params: { target: 'origin' } }),
        },
      ],
    );
    return false;
  };

  const openDestinationSearch = () => {
    if (!requestValidOrigin()) return;
    router.push('/booking/destination');
  };

  const selectRecent = (place: Place) => {
    if (!isPlaceInBolivia(place)) {
      Alert.alert(
        'Destino fuera de cobertura',
        getBoliviaPlaceError(place) ?? BOLIVIA_SERVICE_AREA_MESSAGE,
      );
      return;
    }
    if (!requestValidOrigin()) return;
    setDestination(place);
    router.navigate('/booking/configure');
  };

  if (recoveryFailure || activeRideError || (!activeRide && pendingRatingError)) {
    const recoveryError = activeRideError
      ? activeRideErrorValue
      : pendingRatingErrorValue;
    return (
      <SafeAreaView style={styles.recovery}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.textSecondary} />
        <Text style={styles.recoveryTitle}>No pudimos verificar tus viajes</Text>
        <Text style={styles.recoveryHint}>
          {recoveryFailure ?? getApiErrorMessage(recoveryError)}
        </Text>
        <TouchableOpacity
          style={styles.retry}
          onPress={() => {
            recoveryReadyRef.current = false;
            setRecoveryReady(false);
            setRecoveryFailure(null);
            setRecoveryAttempt((attempt) => attempt + 1);
          }}
          accessibilityRole="button"
          accessibilityLabel="Reintentar recuperación del viaje">
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!recoveryReady || activeRideLoading) {
    return <ActiveRideGate />;
  }

  if (activeRide) {
    return <ActiveRideGate />;
  }

  if (pendingRatingLoading || pendingRatingRide) {
    return <ActiveRideGate />;
  }

  return (
    <View style={styles.root}>
      {status === 'granted' && region ? (
        <MapView
          customMapStyle={estiloMapa}
          userInterfaceStyle={modoMapa}
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          showsBuildings={false}
          showsIndoors={false}
          showsIndoorLevelPicker={false}
          pitchEnabled={false}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          onMapReady={() => {
            mapReady.current = true;
            mapRef.current?.setMapBoundaries(BOLIVIA_NORTH_EAST, BOLIVIA_SOUTH_WEST);
            const pending = pendingAutomaticRegion.current;
            if (!pending || originAdjustedByUser.current) return;
            pendingAutomaticRegion.current = null;
            automaticOriginCoordinates.current = {
              latitude: pending.latitude,
              longitude: pending.longitude,
            };
            mapRef.current?.animateToRegion(pending, 400);
            handleRegionChange(pending);
          }}
          onPanDrag={() => {
            originAdjustedByUser.current = true;
            pendingAutomaticRegion.current = null;
            setOriginManuallyAdjusted(true);
          }}
          onRegionChangeComplete={handleMapRegionChange}
        />
      ) : (
        <MapPlaceholder
          status={status}
          canAskAgain={canAskAgain}
          outsideArea={status === 'granted' && coordinates != null}
          onRetry={retry}
        />
      )}

      {status === 'granted' && region && (
        <CenterPin label={originPinLabel} loading={originResolving} />
      )}

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="ViajaYa">
          <Text style={styles.brandText}>Viaja<Text style={styles.brandAccent}>Ya</Text></Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{firstName(user?.fullName).charAt(0).toUpperCase()}</Text>
        </View>
      </SafeAreaView>

      {status === 'granted' && region && (
        <TouchableOpacity
          style={[styles.recenter, { bottom: sheetPeek + spacing.md }]}
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel="Centrar en mi ubicación">
          <Ionicons name="locate" size={22} color={colors.primary} />
        </TouchableOpacity>
      )}

      {/* El PanResponder está en TODA la tarjeta: se arrastra desde cualquier
          punto. Solo captura si hay desplazamiento vertical, así los taps en los
          botones siguen funcionando. */}
      <Animated.View
        style={[styles.sheet, { height: sheetHeight, transform: [{ translateY }] }]}
        {...pan.panHandlers}>
        <View style={styles.handleArea}>
          <View style={styles.handle} />
        </View>

        <View style={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.greeting}>
            {greeting()}, <Text style={styles.greetingName}>{firstName(user?.fullName)}</Text>
          </Text>

          <TouchableOpacity
            style={styles.search}
            onPress={() => openDestinationSearch()}
            accessibilityRole="button"
            accessibilityLabel="Buscar destino">
            <Ionicons name="search" size={20} color={colors.placeholder} />
            <Text style={styles.searchPlaceholder}>¿A dónde?</Text>
          </TouchableOpacity>

          <Text style={styles.serviceSectionLabel}>Tipo de servicio</Text>
          <ServiceTypeSelector value={service} onChange={setService} />

          {validRecentPlaces.length > 0 && (
            <>
              <View style={styles.recentHeader}>
                <Text style={styles.sectionTitle}>Destinos recientes</Text>
                <TouchableOpacity onPress={openDestinationSearch} accessibilityRole="button">
                  <Text style={styles.viewAll}>Ver todos</Text>
                </TouchableOpacity>
              </View>

              {validRecentPlaces.slice(0, 3).map((place) => (
                <TouchableOpacity
                  key={`${place.coordinates.latitude},${place.coordinates.longitude}`}
                  style={styles.recentItem}
                  onPress={() => selectRecent(place)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ir a ${place.name}`}>
                  <View style={styles.recentIcon}>
                    <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
                  </View>
                  <View style={styles.recentText}>
                    <Text style={styles.recentName}>{place.name}</Text>
                    <Text style={styles.recentAddress}>{place.address}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

function ActiveRideGate() {
  const { colors, styles } = useEstilos(crearEstilos);
  return (
    <SafeAreaView style={styles.recovery}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.recoveryTitle}>Verificando tus viajes…</Text>
    </SafeAreaView>
  );
}

function MapPlaceholder({
  status,
  canAskAgain,
  outsideArea,
  onRetry,
}: {
  status: ReturnType<typeof useCurrentLocation>['status'];
  canAskAgain: boolean;
  outsideArea: boolean;
  onRetry: () => void;
}) {
  const { colors, styles } = useEstilos(crearEstilos);
  if (status === 'loading') {
    return (
      <View style={[styles.placeholder, styles.placeholderBg]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.placeholderText}>Buscando tu ubicación…</Text>
      </View>
    );
  }

  const message = outsideArea
    ? BOLIVIA_SERVICE_AREA_MESSAGE
    : status === 'denied'
      ? 'Activa el permiso de ubicación para ver tu posición en el mapa.'
      : 'No pudimos obtener tu ubicación. Inténtalo de nuevo.';
  const needsSettings = status === 'denied' && !canAskAgain;

  return (
    <View style={[styles.placeholder, styles.placeholderBg]}>
      <Ionicons name="location-outline" size={40} color={colors.textSecondary} />
      <Text style={styles.placeholderText}>{message}</Text>
      <TouchableOpacity
        style={styles.retry}
        onPress={needsSettings ? () => void Linking.openSettings() : onRetry}
        accessibilityRole="button"
        accessibilityLabel={needsSettings ? 'Abrir configuración' : 'Reintentar ubicación'}>
        <Text style={styles.retryText}>
          {needsSettings ? 'Abrir configuración' : 'Reintentar'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
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
  recoveryHint: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
  placeholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  placeholderBg: { backgroundColor: colors.surfaceMuted },
  placeholderText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  retry: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  retryText: { color: colors.textOnPrimary, fontWeight: fontWeight.semibold },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Same wordmark as the logo: white "Viaja" + yellow "Ya" on brand navy.
  brand: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  brandText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textOnBrand },
  brandAccent: { color: colors.accent },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textOnPrimary, fontWeight: fontWeight.bold, fontSize: fontSize.md },

  recenter: {
    position: 'absolute',
    right: spacing.md,
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  handle: { width: 44, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  sheetContent: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.sm },
  greeting: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  greetingName: { color: colors.primary },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  searchPlaceholder: { color: colors.placeholder, fontSize: fontSize.md },
  serviceSectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },

  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  viewAll: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primary },

  recentItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  recentIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentText: { flex: 1 },
  recentName: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  recentAddress: { fontSize: fontSize.sm, color: colors.textSecondary },
});
