/**
 * Background map of the ride in progress: draws the origin→destination street route
 * and refits so both points fit.
 * Reused by the passenger tracking and driver navigation views.
 *
 * In the `pickup` phase (driver assigned, not yet on board) it instead draws the
 * route from the driver's live position to the pickup point, hides the
 * destination and frames only the driver, that route and the pickup point.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { getPlaceStreetName } from '@/features/booking/domain/placeLabels';
import type { Coordinates, Place, ServiceType } from '@/features/booking/domain/types';
import { useRoute } from '@/features/booking/application/useRoute';
import { useMapStyle } from '@/features/booking/presentation/mapStyle';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';
import { RoutePolyline } from '@/features/rides/presentation/RoutePolyline';
import { useMapBearing } from '@/features/rides/application/useMapBearing';
import { usePickupRoute } from '@/features/rides/application/usePickupRoute';
import { isTightCluster } from '@/features/rides/domain/pickupRoute';
import { VehicleMarker } from '@/features/driver/presentation/VehicleMarker';
import type { VehicleType } from '@/features/auth/domain/types';
import { MotorcycleRouteNotice } from './MotorcycleRouteNotice';
import { getTripMapPadding } from './tripMapLayout';

export function TripRouteMap({
  origin,
  service,
  destination,
  topPadding = 120,
  bottomPadding = 320,
  showPlaceNamesInTooltip = false,
  showMotorcycleNotice = true,
  vehicle,
  phase = 'trip',
}: {
  /** `pickup`: driver → pickup point only; `trip`: origin → destination. */
  phase?: 'pickup' | 'trip';
  vehicle?: { coordinates: Coordinates; heading: number | null; type: VehicleType | null; stale?: boolean };
  origin: Place;
  service: ServiceType;
  destination: Place;
  topPadding?: number;
  bottomPadding?: number;
  /** Show each place's name inside its markers' tooltip. */
  showPlaceNamesInTooltip?: boolean;
  /** Disable only when the containing screen renders the notice in its panel. */
  showMotorcycleNotice?: boolean;
}) {
  const mapRef = useRef<MapView>(null);
  const [noticeHeight, setNoticeHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { mapStyle, mapMode } = useMapStyle(true);
  const { mapBearing, mapZoom, updateBearing } = useMapBearing(mapRef);
  const pickupPhase = phase === 'pickup';
  const { route } = useRoute(pickupPhase ? null : origin, pickupPhase ? null : destination, service);

  const vehicleLatitude = vehicle?.coordinates.latitude;
  const vehicleLongitude = vehicle?.coordinates.longitude;
  const vehicleCoordinates = useMemo<Coordinates | null>(() => vehicleLatitude != null && vehicleLongitude != null
    ? { latitude: vehicleLatitude, longitude: vehicleLongitude } : null, [vehicleLatitude, vehicleLongitude]);
  const { route: pickupRoute } = usePickupRoute(pickupPhase ? vehicleCoordinates : null,
    pickupPhase ? origin.coordinates : null, service);

  const region: Region = pickupPhase ? {
    latitude: origin.coordinates.latitude,
    longitude: origin.coordinates.longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  } : {
    latitude: (origin.coordinates.latitude + destination.coordinates.latitude) / 2,
    longitude: (origin.coordinates.longitude + destination.coordinates.longitude) / 2,
    latitudeDelta: Math.max(
      Math.abs(origin.coordinates.latitude - destination.coordinates.latitude) * 1.8,
      0.02,
    ),
    longitudeDelta: Math.max(
      Math.abs(origin.coordinates.longitude - destination.coordinates.longitude) * 1.8,
      0.02,
    ),
  };

  const coordinates = pickupPhase ? pickupRoute?.coordinates : route?.coordinates;
  // Pickup without a route yet: a straight driver→pickup frame (not drawn), or
  // just the pickup point until the driver's position arrives.
  const polyline: Coordinates[] = useMemo(() => {
    if (coordinates && coordinates.length >= 2) return coordinates;
    if (!pickupPhase) return [origin.coordinates, destination.coordinates];
    return vehicleCoordinates ? [vehicleCoordinates, origin.coordinates] : [origin.coordinates];
  }, [coordinates, pickupPhase, vehicleCoordinates, origin.coordinates, destination.coordinates]);

  const fitted = useRef(false);
  const fit = useCallback((animated: boolean) => {
    const map = mapRef.current;
    if (!map || !ready || size.width <= 0 || size.height <= 0) return;
    const points = vehicleCoordinates && !pickupPhase ? [...polyline, vehicleCoordinates] : polyline;
    const edgePadding = getTripMapPadding(size.width, size.height,
      topPadding + (service === 'moto' && showMotorcycleNotice ? noticeHeight : 0), bottomPadding,
      showPlaceNamesInTooltip ? 72 : 40, showPlaceNamesInTooltip ? 88 : 44);
    // A lone pickup point (or a driver already there) would max out the zoom:
    // center it at street level above the sheet instead.
    if (points.length < 2 || isTightCluster(points, 40)) {
      if (!pickupPhase) return;
      map.animateCamera({ center: origin.coordinates, zoom: 17, heading: 0, pitch: 0 }, { duration: animated ? 400 : 0 });
      return;
    }
    // Compact labels need less margin than full addresses. Fit the entire
    // geometry into the remaining viewport without zooming away from the route.
    map.fitToCoordinates(points, { edgePadding, animated });
  }, [ready, size, polyline, topPadding, bottomPadding, showPlaceNamesInTooltip, noticeHeight, service,
    showMotorcycleNotice, vehicleCoordinates, pickupPhase, origin.coordinates]);

  useEffect(() => {
    // The first framing jumps into place; later ones (the vehicle moving) glide.
    fit(fitted.current);
    if (ready && size.width > 0) fitted.current = true;
  }, [fit, ready, size.width]);

  return (
    <>
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      showsBuildings={false}
      showsIndoors={false}
      showsIndoorLevelPicker={false}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      customMapStyle={mapStyle}
      userInterfaceStyle={mapMode}
      // The collision projection shares the route's top-down view.
      pitchEnabled={false}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      zoomTapEnabled={false}
      toolbarEnabled={false}
      moveOnMarkerPress={false}
      onMapReady={() => setReady(true)}
      onRegionChangeComplete={updateBearing}
      // On some Android devices the map is ready before it gets its final size.
      // Refitting after layout keeps the route centered while navigating.
      onLayout={({ nativeEvent: { layout } }) => setSize((current) =>
        current.width === layout.width && current.height === layout.height
          ? current : { width: layout.width, height: layout.height },
      )}>
      <RoutePinMarker
        kind="A"
        coordinate={origin.coordinates}
        route={polyline}
        mapBearing={mapBearing}
        mapZoom={mapZoom}
        label={pickupPhase
          ? (showPlaceNamesInTooltip ? `Recogida: ${getPlaceStreetName(origin)}` : 'Recogida')
          : (showPlaceNamesInTooltip ? `Origen: ${getPlaceStreetName(origin)}` : 'Origen')}
      />
      {!pickupPhase && <RoutePinMarker
        kind="B"
        coordinate={destination.coordinates}
        route={polyline}
        mapBearing={mapBearing}
        mapZoom={mapZoom}
        label={showPlaceNamesInTooltip ? `Destino: ${getPlaceStreetName(destination)}` : 'Destino'}
      />}
      <RoutePolyline coordinates={coordinates ?? []} />
      {vehicle && <VehicleMarker coordinates={vehicle.coordinates} heading={vehicle.heading}
        vehicleType={vehicle.type ?? (service === 'moto' ? 'moto' : service === 'taxi' ? 'taxi' : null)}
        label="Ubicación del conductor" opacity={vehicle.stale ? 0.5 : 1} />}
    </MapView>
    {service === 'moto' && showMotorcycleNotice && <View style={{ position: 'absolute', top: topPadding, left: 12, right: 12 }}
      onLayout={(event) => setNoticeHeight(event.nativeEvent.layout.height)}>
      <MotorcycleRouteNotice service={service} />
    </View>}
    </>
  );
}
