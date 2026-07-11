/**
 * Selección de un punto (origen o destino) moviendo el mapa: el pin queda fijo
 * en el centro y el usuario desplaza el mapa hasta el punto deseado. Al
 * confirmar, ese centro se guarda en el store y se vuelve a configurar el viaje.
 *
 * El punto a fijar lo decide el parámetro de ruta `target` ('origin' |
 * 'destination'); por defecto, destino. El pin es azul para el origen y rojo
 * para el destino. El `Place` vive en estado local hasta que se confirma.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRegionPlace } from '@/features/booking/application/useRegionPlace';
import {
  BOLIVIA_DEFAULT_COORDINATES,
  BOLIVIA_NORTH_EAST,
  BOLIVIA_SOUTH_WEST,
  distanceMeters,
  getBoliviaPlaceError,
  isCoordinatesInBolivia,
  isPlaceInBolivia,
} from '@/features/booking/domain/bolivia';
import type { Place } from '@/features/booking/domain/types';
import { CenterPin } from '@/features/booking/presentation/CenterPin';
import { useCurrentLocation } from '@/features/home/application/useCurrentLocation';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';

const MIN_DESTINATION_DISTANCE_METERS = 50;

export function PickOnMapScreen() {
  const router = useRouter();
  const { target, saveAs, category, id, label, rideId } = useLocalSearchParams<{
    target?: string;
    saveAs?: string;
    category?: string;
    id?: string;
    label?: string;
    rideId?: string;
  }>();
  // Modo "guardar lugar": el confirmar lleva al formulario de lugar guardado en
  // vez de a configurar el viaje. Conserva categoría/id/label para reenviarlos.
  const isSaveAs = saveAs === '1';
  const isOrigin = target === 'origin';
  const isDestination = !isSaveAs && !isOrigin;
  const noun = isSaveAs ? 'lugar' : isOrigin ? 'origen' : 'destino';
  const pinColor = isSaveAs || isOrigin ? colors.primary : colors.danger;

  const origin = useBookingStore((s) => s.origin);
  const setOrigin = useBookingStore((s) => s.setOrigin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const {
    status: locationStatus,
    coordinates,
    canAskAgain,
    retry: retryLocation,
  } = useCurrentLocation();
  const mapRef = useRef<MapView>(null);
  const usableOrigin = origin && isPlaceInBolivia(origin) ? origin : null;
  const usableCoordinates =
    coordinates && isCoordinatesInBolivia(coordinates) ? coordinates : null;
  // Solo seguimos al GPS tardío si de verdad no había origen ni GPS al iniciar.
  const startedWithoutPreferredCenter = useRef(!usableOrigin && !usableCoordinates);

  // El destino B siempre comienza desde el origen A. Origen y lugares guardados
  // también priorizan el origen vigente antes de recurrir al GPS.
  const initialRegion = useMemo<Region | undefined>(() => {
    const center =
      usableOrigin?.coordinates ??
      usableCoordinates ??
      (locationStatus === 'loading' ? undefined : BOLIVIA_DEFAULT_COORDINATES);
    if (!center) return undefined;
    return {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [usableOrigin, usableCoordinates, locationStatus]);

  const [place, setPlace] = useState<Place | null>(null);
  const [destinationMoved, setDestinationMoved] = useState(false);
  const { onRegionChangeComplete: handleRegionChange, isResolving } = useRegionPlace(
    setPlace,
    isSaveAs ? 'Lugar' : isOrigin ? 'Origen' : 'Destino',
  );

  // Siembra la dirección del centro inicial. Solo dispara trabajo asíncrono
  // (el setState ocurre en el `.then`, no de forma síncrona dentro del efecto).
  const seeded = useRef(false);
  useEffect(() => {
    if (!initialRegion || seeded.current) return;
    seeded.current = true;
    handleRegionChange(initialRegion);
  }, [handleRegionChange, initialRegion]);

  // Si el permiso llega después de mostrar la región de respaldo, centra una
  // sola vez en la ubicación recién obtenida sin interrumpir ajustes posteriores.
  useEffect(() => {
    if (!usableCoordinates || !startedWithoutPreferredCenter.current) return;
    startedWithoutPreferredCenter.current = false;
    mapRef.current?.animateToRegion(
      { ...usableCoordinates, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400,
    );
  }, [usableCoordinates]);

  const recoverLocation = () => {
    if (locationStatus === 'denied' && !canAskAgain) {
      void Linking.openSettings();
      return;
    }
    retryLocation();
  };

  const recenter = () => {
    if (!usableCoordinates) {
      recoverLocation();
      return;
    }
    if (isDestination) setDestinationMoved(true);
    mapRef.current?.animateToRegion(
      { ...usableCoordinates, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400,
    );
  };

  const locationUnavailable =
    !usableCoordinates &&
    (locationStatus === 'denied' || locationStatus === 'error' || coordinates != null);
  const placeAreaError = place && !isResolving ? getBoliviaPlaceError(place) : null;
  const destinationTooClose =
    isDestination &&
    usableOrigin != null &&
    place != null &&
    distanceMeters(usableOrigin.coordinates, place.coordinates) < MIN_DESTINATION_DISTANCE_METERS;
  const destinationNeedsMove = isDestination && usableOrigin != null && !destinationMoved;
  const confirmDisabled =
    !place ||
    isResolving ||
    placeAreaError != null ||
    destinationNeedsMove ||
    destinationTooClose;
  const validationMessage = placeAreaError
    ? placeAreaError
    : destinationNeedsMove || destinationTooClose
      ? 'Mueve el pin B al menos 50 metros desde el origen A.'
      : null;

  const confirm = () => {
    if (!place || confirmDisabled) return;
    if (isSaveAs) {
      // Reemplaza el mapa por el formulario para nombrar/categorizar el lugar,
      // reenviando id/label/category (edición) y el punto elegido.
      router.replace({
        pathname: '/booking/edit-place',
        params: {
          ...(id ? { id } : {}),
          ...(label ? { label } : {}),
          ...(category ? { category } : {}),
          ...(rideId ? { rideId } : {}),
          lat: String(place.coordinates.latitude),
          lng: String(place.coordinates.longitude),
          name: place.name,
          address: place.address,
          ...(place.countryCode ? { countryCode: place.countryCode } : {}),
        },
      });
      return;
    }
    (isOrigin ? setOrigin : setDestination)(place);
    router.dismissTo({
      pathname: '/booking/configure',
      params: rideId ? { rideId } : {},
    });
  };

  if (!initialRegion) {
    return (
      <View style={[styles.root, styles.loading]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Cargando mapa…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        onMapReady={() =>
          mapRef.current?.setMapBoundaries(BOLIVIA_NORTH_EAST, BOLIVIA_SOUTH_WEST)
        }
        onPanDrag={() => {
          if (isDestination) setDestinationMoved(true);
        }}
        onRegionChangeComplete={handleRegionChange}>
        {isDestination && usableOrigin ? (
          <RoutePinMarker kind="A" coordinate={usableOrigin.coordinates} label="Origen" />
        ) : null}
      </MapView>

      <CenterPin label={isDestination ? 'Destino B' : `Fijar ${noun}`} color={pinColor} />

      <SafeAreaView style={styles.topArea} edges={['top']} pointerEvents="box-none">
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.back}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.addressPill}>
            <Ionicons name="location" size={18} color={pinColor} />
            <Text style={styles.addressText} numberOfLines={1}>
              {place?.address ?? `Mueve el mapa para fijar el ${noun}`}
            </Text>
          </View>
        </View>
        {isDestination && usableOrigin ? (
          <View style={styles.originReference} accessibilityLabel={`Origen A, ${usableOrigin.name}`}>
            <View style={styles.originBadge}>
              <Text style={styles.originBadgeText}>A</Text>
            </View>
            <View style={styles.originReferenceText}>
              <Text style={styles.originReferenceLabel}>ORIGEN</Text>
              <Text style={styles.originReferenceName} numberOfLines={1}>
                {usableOrigin.name}
              </Text>
            </View>
          </View>
        ) : null}
        {locationUnavailable && (
          <TouchableOpacity
            style={styles.locationWarning}
            onPress={recoverLocation}
            accessibilityRole="button"
            accessibilityLabel={
              locationStatus === 'denied' && !canAskAgain
                ? 'Abrir configuración de ubicación'
                : 'Reintentar ubicación actual'
            }>
            <Ionicons name="navigate-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.locationWarningText} numberOfLines={2}>
              {locationStatus === 'denied' && !canAskAgain
                ? 'Activa la ubicación en configuración o mueve el mapa manualmente.'
                : coordinates && !usableCoordinates
                  ? 'Tu ubicación está fuera de Bolivia. Mueve el mapa dentro del área disponible.'
                : 'No pudimos usar tu ubicación. Puedes mover el mapa o reintentar.'}
            </Text>
            <Ionicons name="refresh" size={18} color={colors.primary} />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      <TouchableOpacity
        style={styles.recenter}
        onPress={recenter}
        accessibilityRole="button"
        accessibilityLabel={
          usableCoordinates
            ? 'Centrar en mi ubicación'
            : locationStatus === 'denied' && !canAskAgain
              ? 'Abrir configuración de ubicación'
              : 'Reintentar ubicación'
        }>
        <Ionicons
          name={
            usableCoordinates
              ? 'locate'
              : locationStatus === 'denied' && !canAskAgain
                ? 'settings-outline'
                : 'refresh'
          }
          size={22}
          color={colors.primary}
        />
      </TouchableOpacity>

      <SafeAreaView style={styles.bottom} edges={['bottom']}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>
            {isSaveAs ? 'NUEVO LUGAR' : isOrigin ? 'PUNTO DE PARTIDA' : 'DESTINO'}
          </Text>
          <Text style={styles.cardValue} numberOfLines={1}>
            {place?.name ?? 'Mueve el mapa'}
          </Text>
          <Text style={styles.cardAddress} numberOfLines={1}>
            {place?.address ?? `para fijar el ${noun}`}
          </Text>
          {validationMessage ? (
            <Text style={styles.validationMessage} accessibilityLiveRegion="polite">
              {validationMessage}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.confirm, confirmDisabled && styles.confirmDisabled]}
          disabled={confirmDisabled}
          onPress={confirm}
          accessibilityRole="button"
          accessibilityState={{ disabled: confirmDisabled, busy: isResolving }}
          accessibilityLabel={isSaveAs ? 'Usar esta ubicación' : 'Confirmar ubicación'}>
          <Text style={styles.confirmText}>
            {isResolving
              ? 'Obteniendo dirección…'
              : validationMessage
                ? 'Elige otro punto'
                : isSaveAs
                  ? 'Usar esta ubicación'
                  : 'Confirmar ubicación'}
          </Text>
          {isResolving ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Ionicons name="arrow-forward" size={20} color={colors.textOnPrimary} />
          )}
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  loading: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { color: colors.textSecondary, fontSize: fontSize.sm },

  topArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
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
  addressPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addressText: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  originReference: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  originBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  originBadgeText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  originReferenceText: { flex: 1 },
  originReferenceLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  originReferenceName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  locationWarning: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationWarningText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.xs },

  recenter: {
    position: 'absolute',
    right: spacing.md,
    bottom: 200,
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

  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  card: { gap: spacing.xs },
  cardLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  cardValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  cardAddress: { fontSize: fontSize.sm, color: colors.textSecondary },
  validationMessage: { color: colors.danger, fontSize: fontSize.xs },

  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
