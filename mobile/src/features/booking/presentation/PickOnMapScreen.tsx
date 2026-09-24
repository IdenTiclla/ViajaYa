/**
 * Pick a point (origin or destination) by moving the map: the pin stays fixed
 * at the center and the user pans the map to the desired point. On
 * confirm, that center is saved in the store and the user goes back to configure the trip.
 *
 * The point to set is decided by the `target` route param ('origin' |
 * 'destination'); destination by default. The pin is blue for the origin and red
 * for the destination. The `Place` lives in local state until confirmed.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Details, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useMapStyle } from '@/features/booking/presentation/mapStyle';
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
import {
  getPlaceStreetName,
  isPlaceLabelResolved,
} from '@/features/booking/domain/placeLabels';
import type { Place } from '@/features/booking/domain/types';
import { CenterPin } from '@/features/booking/presentation/CenterPin';
import { useCurrentLocation } from '@/features/home/application/useCurrentLocation';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';
import { Button, PinLoadingIndicator } from '@/shared/components';

const MIN_DESTINATION_DISTANCE_METERS = 50;

function coordinatesNearlyEqual(a: Place['coordinates'], b: Place['coordinates']): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 0.00001 &&
    Math.abs(a.longitude - b.longitude) < 0.00001
  );
}

export function PickOnMapScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { target, saveAs, category, id, label, rideId } = useLocalSearchParams<{
    target?: string;
    saveAs?: string;
    category?: string;
    id?: string;
    label?: string;
    rideId?: string;
  }>();
  // "Save place" mode: confirming leads to the saved place form instead of
  // configuring the trip. Keeps category/id/label to forward them.
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
    isEstimated,
    retry: retryLocation,
  } = useCurrentLocation();
  const mapRef = useRef<MapView>(null);
  const { mapStyle, mapMode } = useMapStyle(false);
  const mapReady = useRef(false);
  const pendingGpsRegion = useRef<{ region: Region; isEstimated: boolean } | null>(null);
  const usableOrigin = origin && isPlaceInBolivia(origin) ? origin : null;
  const usableCoordinates =
    coordinates && isCoordinatesInBolivia(coordinates) ? coordinates : null;
  // Only follow a late GPS fix if there really was no origin or GPS at start.
  const startedWithoutPreferredCenter = useRef(
    !usableOrigin && (!usableCoordinates || isEstimated),
  );

  // Destination B always starts from origin A. Origin and saved places
  // also prefer the current origin before falling back to GPS.
  const initialRegion = useMemo<Region>(() => {
    const center =
      usableOrigin?.coordinates ??
      usableCoordinates ??
      BOLIVIA_DEFAULT_COORDINATES;
    return {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [usableOrigin, usableCoordinates]);

  const [place, setPlace] = useState<Place | null>(null);
  const [destinationMoved, setDestinationMoved] = useState(false);
  const [hasSelectedCenter, setHasSelectedCenter] = useState(
    Boolean(usableOrigin || usableCoordinates),
  );
  const centerAdjustedByUser = useRef(false);
  const automaticCenterCoordinates = useRef<Place['coordinates']>({
    latitude: initialRegion.latitude,
    longitude: initialRegion.longitude,
  });
  const {
    onRegionChangeComplete: handleRegionChange,
    isResolving,
    resolutionFailed,
  } = useRegionPlace(setPlace);
  const pointLabel = isSaveAs ? 'Lugar' : isOrigin ? 'Origen' : 'Destino';
  const hasResolvedLabel = place != null && isPlaceLabelResolved(place);
  const currentPointName = isResolving
    ? 'Obteniendo lugar…'
    : hasResolvedLabel && place
      ? getPlaceStreetName(place)
      : resolutionFailed
        ? 'Dirección pendiente'
        : place
          ? 'Obteniendo dirección…'
          : 'Mueve el mapa';
  const centerPinLabel = isResolving
    ? `${pointLabel}: Obteniendo lugar…`
    : `${pointLabel}: ${currentPointName}`;
  const currentPointAddress = isResolving
    ? 'Estamos ubicando la dirección exacta'
    : hasResolvedLabel
      ? (place?.address ?? '')
      : resolutionFailed
        ? 'No pudimos obtener el nombre. Puedes mover el mapa para reintentar.'
        : `Mueve el mapa para fijar el ${noun}`;
  const originPinLabel = usableOrigin
    ? `Origen: ${getPlaceStreetName(usableOrigin)}`
    : 'Origen: Sin definir';

  // Seed the address of the initial center. It only fires async work
  // (the setState happens in `.then`, not synchronously inside the effect).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    // The national center is only a visual reference while GPS arrives:
    // it must not keep the geocoder busy with an address the user did not choose.
    if (isDestination || (!usableOrigin && !usableCoordinates)) return;
    handleRegionChange(initialRegion);
  }, [handleRegionChange, initialRegion, isDestination, usableCoordinates, usableOrigin]);

  // If the permission arrives after showing the fallback region, center once
  // on the newly obtained location without interrupting later adjustments.
  useEffect(() => {
    if (!usableCoordinates || !startedWithoutPreferredCenter.current) return;
    const nextRegion = { ...usableCoordinates, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    if (!mapReady.current) {
      pendingGpsRegion.current = { region: nextRegion, isEstimated };
      return;
    }

    pendingGpsRegion.current = null;
    centerAdjustedByUser.current = false;
    automaticCenterCoordinates.current = usableCoordinates;
    setHasSelectedCenter(true);
    mapRef.current?.animateToRegion(nextRegion, 400);
    handleRegionChange(nextRegion);
    if (!isEstimated) startedWithoutPreferredCenter.current = false;
  }, [handleRegionChange, isEstimated, usableCoordinates]);

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
    const nextRegion = { ...usableCoordinates, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    if (!mapReady.current) {
      pendingGpsRegion.current = { region: nextRegion, isEstimated };
      return;
    }
    centerAdjustedByUser.current = false;
    automaticCenterCoordinates.current = usableCoordinates;
    setHasSelectedCenter(true);
    startedWithoutPreferredCenter.current = isEstimated;
    mapRef.current?.animateToRegion(nextRegion, 400);
    handleRegionChange(nextRegion);
  };

  const handleMapRegionChange = (nextRegion: Region, details: Details) => {
    if (details.isGesture) {
      startedWithoutPreferredCenter.current = false;
      pendingGpsRegion.current = null;
      centerAdjustedByUser.current = true;
      setHasSelectedCenter(true);
      if (isDestination) setDestinationMoved(true);
      handleRegionChange(nextRegion);
      return;
    }
    // Automatic centers are already sent explicitly to the hook. MapView
    // notifies them again when the animation ends and they must not duplicate the query.
    if (!centerAdjustedByUser.current) return;
    if (coordinatesNearlyEqual(nextRegion, automaticCenterCoordinates.current)) return;
    handleRegionChange(nextRegion);
  };

  const locationUnavailable =
    !usableCoordinates &&
    (locationStatus === 'denied' || locationStatus === 'error' || coordinates != null);
  const placeAreaError = place ? getBoliviaPlaceError(place) : null;
  const destinationTooClose =
    isDestination &&
    usableOrigin != null &&
    place != null &&
    distanceMeters(usableOrigin.coordinates, place.coordinates) < MIN_DESTINATION_DISTANCE_METERS;
  const destinationNeedsMove = isDestination && usableOrigin != null && !destinationMoved;
  const confirmDisabled =
    !place ||
    !hasSelectedCenter ||
    placeAreaError != null ||
    (isSaveAs && !hasResolvedLabel) ||
    destinationNeedsMove ||
    destinationTooClose;
  const validationMessage = !hasSelectedCenter
    ? `Mueve el mapa para fijar el ${noun}.`
    : isSaveAs && resolutionFailed
      ? 'No pudimos obtener el nombre del lugar. Mueve el mapa para reintentar.'
    : placeAreaError
      ? placeAreaError
      : destinationNeedsMove || destinationTooClose
        ? 'Mueve el pin B al menos 50 metros desde el origen A.'
        : null;
  const confirmLabel = isSaveAs
    ? 'Usar esta ubicación'
    : isOrigin
      ? 'Confirmar origen'
      : 'Confirmar destino';
  const destinationFloatingBottom = 54 + spacing.md * 2 + spacing.sm + insets.bottom;

  const confirm = () => {
    if (!place || confirmDisabled) return;
    if (isSaveAs) {
      // Replace the map with the form to name/categorize the place,
      // forwarding id/label/category (edit) and the chosen point.
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

  return (
    <View style={styles.root}>
      <MapView
        customMapStyle={mapStyle}
        userInterfaceStyle={mapMode}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        showsBuildings={false}
        showsIndoors={false}
        showsIndoorLevelPicker={false}
        pitchEnabled={false}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        onMapReady={() => {
          mapReady.current = true;
          mapRef.current?.setMapBoundaries(BOLIVIA_NORTH_EAST, BOLIVIA_SOUTH_WEST);
          const pending = pendingGpsRegion.current;
          if (!pending) return;
          pendingGpsRegion.current = null;
          centerAdjustedByUser.current = false;
          automaticCenterCoordinates.current = pending.region;
          setHasSelectedCenter(true);
          mapRef.current?.animateToRegion(pending.region, 400);
          handleRegionChange(pending.region);
          if (!pending.isEstimated) startedWithoutPreferredCenter.current = false;
        }}
        onPanDrag={() => {
          startedWithoutPreferredCenter.current = false;
          pendingGpsRegion.current = null;
          centerAdjustedByUser.current = true;
          setHasSelectedCenter(true);
          if (isDestination) setDestinationMoved(true);
        }}
        onRegionChangeComplete={handleMapRegionChange}>
        {isDestination && usableOrigin ? (
          <RoutePinMarker
            kind="A"
            coordinate={usableOrigin.coordinates}
            label={originPinLabel}
          />
        ) : null}
      </MapView>

      <CenterPin
        label={centerPinLabel}
        kind={isSaveAs ? 'place' : isOrigin ? 'origin' : 'destination'}
        loading={isResolving}
      />

      <SafeAreaView style={styles.topArea} edges={['top']} pointerEvents="box-none">
        <View style={styles.topBar}>
          {!isDestination && (
            <TouchableOpacity
              style={[styles.back, !isSaveAs && styles.backWithRoute]}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Volver">
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          )}
          {isSaveAs ? (
            <View style={styles.contextPill}>
              <Ionicons name="map-outline" size={18} color={pinColor} />
              <Text style={styles.contextText} numberOfLines={1}>
                Ubica el lugar en el mapa
              </Text>
            </View>
          ) : (
            <View style={styles.routePoints}>
              <SelectionPointRow
                kind="A"
                tooltipLabel={isOrigin ? centerPinLabel : originPinLabel}
                address={
                  isOrigin
                    ? currentPointAddress
                    : usableOrigin?.address ?? 'Origen confirmado'
                }
                active={isOrigin}
                loading={isOrigin && isResolving}
              />
              {isDestination && (
                <>
                  <View style={styles.routeConnection}>
                    <View style={styles.routeConnectionLine} />
                    <View style={styles.routeConnectionDivider} />
                  </View>
                  <SelectionPointRow
                    kind="B"
                    tooltipLabel={centerPinLabel}
                    address={validationMessage ?? currentPointAddress}
                    active
                    error={validationMessage != null}
                    loading={isResolving}
                  />
                </>
              )}
            </View>
          )}
        </View>
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
        style={[
          styles.recenter,
          isDestination && { bottom: destinationFloatingBottom },
        ]}
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

      {isDestination && (
        <TouchableOpacity
          style={[styles.bottomBack, { bottom: destinationFloatingBottom }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text style={styles.bottomBackText}>Volver</Text>
        </TouchableOpacity>
      )}

      <SafeAreaView style={styles.bottom} edges={['bottom']}>
        {!isDestination && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>
              {isSaveAs ? 'NUEVO LUGAR' : `${pointLabel.toUpperCase()}:`}
            </Text>
            <Text style={styles.cardValue} numberOfLines={1}>
              {currentPointName}
            </Text>
            <Text style={styles.cardAddress} numberOfLines={1}>
              {currentPointAddress}
            </Text>
            {validationMessage ? (
              <Text style={styles.validationMessage} accessibilityLiveRegion="polite">
                {validationMessage}
              </Text>
            ) : null}
          </View>
        )}
        <Button
          title={validationMessage ? hasSelectedCenter ? 'Elige otro punto' : 'Mueve el mapa' : confirmLabel}
          trailingIcon="arrow-forward"
          loading={isResolving && confirmDisabled}
          accessibilityState={{ busy: isResolving }}
          loadingLabel="Obteniendo dirección…"
          disabled={confirmDisabled}
          onPress={confirm}
        />
      </SafeAreaView>
    </View>
  );
}

function SelectionPointRow({
  kind,
  tooltipLabel,
  address,
  active,
  error = false,
  loading = false,
}: {
  kind: 'A' | 'B';
  tooltipLabel: string;
  address: string;
  active: boolean;
  error?: boolean;
  loading?: boolean;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View
      style={[
        styles.routePoint,
        active &&
          (kind === 'A' ? styles.routePointActiveOrigin : styles.routePointActiveDestination),
      ]}
      accessible
      accessibilityLabel={`${tooltipLabel}. ${address}`}
      accessibilityState={{ selected: active }}>
      <View
        style={[
          styles.routePointBadge,
          kind === 'A' ? styles.routePointBadgeOrigin : styles.routePointBadgeDestination,
        ]}>
        <Text style={[styles.routePointBadgeText, loading && styles.hiddenPinContent]}>{kind}</Text>
        <View style={styles.routePointBadgeLoader} pointerEvents="none">
          <PinLoadingIndicator loading={loading} color={colors.textOnPrimary} compact />
        </View>
      </View>
      <View style={styles.routePointCopy}>
        <Text style={styles.routePointTitle} numberOfLines={2} ellipsizeMode="tail">
          {tooltipLabel}
        </Text>
        <Text
          style={[styles.routePointAddress, error && styles.routePointAddressError]}
          numberOfLines={error ? 2 : 1}
          ellipsizeMode="tail"
          accessibilityLiveRegion={error ? 'polite' : 'none'}>
          {address}
        </Text>
      </View>
      <Ionicons
        name={active ? 'locate' : 'checkmark-circle'}
        size={20}
        color={active ? (kind === 'A' ? colors.primary : colors.danger) : colors.success}
      />
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },

  topArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  backWithRoute: { marginTop: 11 },
  contextPill: {
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
  contextText: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  routePoints: {
    flex: 1,
    minWidth: 0,
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  routePoint: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  routePointActiveOrigin: { backgroundColor: colors.primarySoft },
  routePointActiveDestination: { backgroundColor: colors.dangerSoft },
  routePointBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routePointBadgeOrigin: { backgroundColor: colors.primary },
  routePointBadgeDestination: { backgroundColor: colors.danger },
  routePointBadgeText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  hiddenPinContent: { opacity: 0 },
  routePointBadgeLoader: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routePointCopy: { flex: 1, minWidth: 0, gap: 2 },
  routePointTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    lineHeight: 18,
  },
  routePointAddress: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 16 },
  routePointAddressError: { color: colors.danger, fontWeight: fontWeight.semibold },
  routeConnection: {
    height: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.sm,
  },
  routeConnectionLine: {
    width: 2,
    height: 12,
    marginLeft: 13,
    backgroundColor: colors.border,
  },
  routeConnectionDivider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.md + 1,
    backgroundColor: colors.border,
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
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
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

  bottomBack: {
    position: 'absolute',
    left: spacing.sm,
    zIndex: 13,
    minWidth: 104,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 13,
  },
  bottomBackText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },

});
