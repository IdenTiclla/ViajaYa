import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import { useRegionPlace } from '@/features/booking/application/useRegionPlace';
import type { Place, ServiceType } from '@/features/booking/domain/types';
import { CenterPin } from '@/features/booking/presentation/CenterPin';
import { useCurrentLocation } from '@/features/home/application/useCurrentLocation';
import {
  PASSENGER_ACTIVE_RIDE_KEY,
  usePendingRatingRide,
  usePassengerActiveRide,
} from '@/features/rides/application/useRides';
import type { Ride } from '@/features/rides/domain/types';
import { useAuthStore } from '@/store/authStore';

const SERVICES: { id: ServiceType; label: string; caption: string; icon: 'car-sport' | 'bicycle' }[] =
  [
    { id: 'taxi', label: 'Taxi', caption: 'Rápido y cómodo', icon: 'car-sport' },
    { id: 'moto', label: 'Moto', caption: 'Ágil en el tráfico', icon: 'bicycle' },
  ];

// El bottom sheet se desliza entre dos posiciones: colapsado (deja ver/usar gran
// parte del mapa) y expandido (muestra todo el contenido).
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.74); // alto total de la tarjeta
const SHEET_PEEK = 268; // alto visible cuando está colapsado
const MAX_TRANSLATE = SHEET_HEIGHT - SHEET_PEEK; // cuánto baja al colapsar

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function firstName(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? 'viajero';
}

export function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();
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
  const { status, coordinates, retry } = useCurrentLocation();
  const mapRef = useRef<MapView>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const recoveryReadyRef = useRef(false);

  const setOrigin = useBookingStore((s) => s.setOrigin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const setService = useBookingStore((s) => s.setService);
  const { places: recentPlaces } = useRecentDestinations();
  // Al terminar de mover el mapa, el centro pasa a ser el punto de partida.
  const handleRegionChange = useRegionPlace(setOrigin, 'Punto de partida');

  // Empieza colapsado (mapa visible). translateY: 0 = expandido, MAX = colapsado.
  // `useState` con inicializador perezoso crea valores estables; el offset del
  // arrastre lo lleva el propio Animated.Value (extractOffset/flattenOffset),
  // así no hace falta una ref accedida durante el render.
  const [translateY] = useState(() => new Animated.Value(MAX_TRANSLATE));

  const [pan] = useState(() =>
    PanResponder.create({
      // Solo toma el gesto si es un arrastre vertical claro (deja pasar taps).
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      // Conserva la posición actual como base del arrastre.
      onPanResponderGrant: () => translateY.extractOffset(),
      onPanResponderMove: (_, g) => translateY.setValue(g.dy),
      onPanResponderRelease: (_, g) => {
        translateY.flattenOffset();
        translateY.stopAnimation((value) => {
          // Snap a la posición más cercana, o según la velocidad del gesto.
          const target =
            g.vy > 0.5
              ? MAX_TRANSLATE
              : g.vy < -0.5
                ? 0
                : value > MAX_TRANSLATE / 2
                  ? MAX_TRANSLATE
                  : 0;
          Animated.spring(translateY, {
            toValue: target,
            useNativeDriver: false,
            bounciness: 2,
          }).start();
        });
      },
    }),
  );

  const region = useMemo<Region | undefined>(() => {
    if (!coordinates) return undefined;
    return {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [coordinates]);

  // Siembra el origen con la ubicación actual la primera vez que llega.
  const seeded = useRef(false);
  useEffect(() => {
    if (region && !seeded.current) {
      seeded.current = true;
      handleRegionChange(region);
    }
  }, [region, handleRegionChange]);

  // Cada entrada a Home confirma primero el estado autoritativo. React Query puede
  // conservar SEARCHING durante 30 s; navegar antes de este refetch revive viajes
  // que el pasajero acaba de cancelar.
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      recoveryReadyRef.current = false;
      setRecoveryReady(false);

      const recover = async () => {
        try {
          const activeResult = await refetchActiveRide();
          if (activeResult.isSuccess && activeResult.data == null) {
            await refetchPendingRating();
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
    }, [refetchActiveRide, refetchPendingRating]),
  );

  // Recupera el punto exacto del flujo una vez terminada la verificacion fresca.
  // El foco evita navegar desde el Home que permanece montado debajo del stack.
  useFocusEffect(
    useCallback(() => {
      if (
        !recoveryReadyRef.current ||
        !recoveryReady ||
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
      router,
    ]),
  );

  const recenter = () => {
    if (region) mapRef.current?.animateToRegion(region, 500);
  };

  const openDestinationSearch = (service?: ServiceType) => {
    if (service) setService(service);
    router.push('/booking/destination');
  };

  const selectRecent = (place: Place) => {
    setDestination(place);
    router.navigate('/booking/configure');
  };

  if (!recoveryReady || activeRideLoading) {
    return <ActiveRideGate />;
  }

  if (activeRideError || (!activeRide && pendingRatingError)) {
    const recoveryError = activeRideError
      ? activeRideErrorValue
      : pendingRatingErrorValue;
    return (
      <SafeAreaView style={styles.recovery}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.textSecondary} />
        <Text style={styles.recoveryTitle}>No pudimos verificar tus viajes</Text>
        <Text style={styles.recoveryHint}>{getApiErrorMessage(recoveryError)}</Text>
        <TouchableOpacity
          style={styles.retry}
          onPress={() => {
            void refetchActiveRide();
            void refetchPendingRating();
          }}
          accessibilityRole="button"
          accessibilityLabel="Reintentar recuperación del viaje">
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (activeRide) {
    return <ActiveRideGate />;
  }

  if (pendingRatingLoading || pendingRatingFetching || pendingRatingRide) {
    return <ActiveRideGate />;
  }

  return (
    <View style={styles.root}>
      {status === 'granted' && region ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          onRegionChangeComplete={handleRegionChange}
        />
      ) : (
        <MapPlaceholder status={status} onRetry={retry} />
      )}

      {status === 'granted' && region && <CenterPin label="Punto de partida" />}

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <TopBarButton icon="menu" accessibilityLabel="Abrir menú" />
        <Text style={styles.brand}>TaxiGo</Text>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{firstName(user?.fullName).charAt(0).toUpperCase()}</Text>
        </View>
      </SafeAreaView>

      {status === 'granted' && (
        <TouchableOpacity
          style={styles.recenter}
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
        style={[styles.sheet, { height: SHEET_HEIGHT, transform: [{ translateY }] }]}
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

          <View style={styles.services}>
            {SERVICES.map((service) => (
              <TouchableOpacity
                key={service.id}
                style={styles.serviceCard}
                onPress={() => openDestinationSearch(service.id)}
                accessibilityRole="button"
                accessibilityLabel={`Pedir ${service.label}`}>
                <View style={styles.serviceIcon}>
                  <Ionicons name={service.icon} size={26} color={colors.primaryDark} />
                </View>
                <Text style={styles.serviceLabel}>{service.label}</Text>
                <Text style={styles.serviceCaption}>{service.caption}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {recentPlaces.length > 0 && (
            <>
              <View style={styles.recentHeader}>
                <Text style={styles.sectionTitle}>Destinos recientes</Text>
                <TouchableOpacity onPress={() => openDestinationSearch()} accessibilityRole="button">
                  <Text style={styles.viewAll}>Ver todos</Text>
                </TouchableOpacity>
              </View>

              {recentPlaces.slice(0, 3).map((place) => (
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
  return (
    <SafeAreaView style={styles.recovery}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.recoveryTitle}>Recuperando tu viaje…</Text>
    </SafeAreaView>
  );
}

function TopBarButton({
  icon,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity
      style={styles.topBarButton}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      <Ionicons name={icon} size={24} color={colors.text} />
    </TouchableOpacity>
  );
}

function MapPlaceholder({
  status,
  onRetry,
}: {
  status: ReturnType<typeof useCurrentLocation>['status'];
  onRetry: () => void;
}) {
  if (status === 'loading') {
    return (
      <View style={[styles.placeholder, styles.placeholderBg]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.placeholderText}>Buscando tu ubicación…</Text>
      </View>
    );
  }

  const message =
    status === 'denied'
      ? 'Activa el permiso de ubicación para ver tu posición en el mapa.'
      : 'No pudimos obtener tu ubicación. Inténtalo de nuevo.';

  return (
    <View style={[styles.placeholder, styles.placeholderBg]}>
      <Ionicons name="location-outline" size={40} color={colors.textSecondary} />
      <Text style={styles.placeholderText}>{message}</Text>
      <TouchableOpacity style={styles.retry} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.retryText}>Reintentar</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
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
  topBarButton: {
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
  brand: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.primary },
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
    bottom: SHEET_PEEK + spacing.md,
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
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  greeting: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  greetingName: { color: colors.primary },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 54,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  searchPlaceholder: { color: colors.placeholder, fontSize: fontSize.md },

  services: { flexDirection: 'row', gap: spacing.md },
  serviceCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  serviceIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  serviceLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  serviceCaption: { fontSize: fontSize.xs, color: colors.textSecondary },

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
