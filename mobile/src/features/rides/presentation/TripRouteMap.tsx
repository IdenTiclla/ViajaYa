import { VehicleMarker } from '@/features/driver/presentation/MarcadorVehiculo';
import type { VehicleType } from '@/features/auth/domain/types';
/**
 * Background map of the ride in progress: draws the origin→destination street route
 * and refits so both points fit.
 * Reused by the passenger tracking and driver navigation views.
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
import { useMapBearing } from '@/features/rides/application/useRumboMapa';
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
}: {
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
  const { route } = useRoute(origin, destination, service);

  const region: Region = {
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

  const coordinates = route?.coordinates;
  const polyline: Coordinates[] = useMemo(() => coordinates && coordinates.length >= 2
    ? coordinates
    : [origin.coordinates, destination.coordinates], [coordinates, origin.coordinates, destination.coordinates]);

  const vehicleLatitude = vehicle?.coordinates.latitude;
  const vehicleLongitude = vehicle?.coordinates.longitude;
  const fit = useCallback((animated: boolean) => {
    if (!ready || size.width <= 0 || size.height <= 0 || polyline.length < 2) return;
    // Compact labels need less margin than full addresses. Fit the entire
    // geometry into the remaining viewport without zooming away from the route.
    const tooltipInset = showPlaceNamesInTooltip ? 72 : 40;
    const tooltipSideInset = showPlaceNamesInTooltip ? 88 : 44;
    mapRef.current?.fitToCoordinates(vehicleLatitude != null && vehicleLongitude != null ? [...polyline, { latitude: vehicleLatitude, longitude: vehicleLongitude }] : polyline, {
      edgePadding: getTripMapPadding(size.width, size.height, topPadding + (service === 'moto' && showMotorcycleNotice ? noticeHeight : 0), bottomPadding, tooltipInset, tooltipSideInset),
      animated,
    });
  }, [ready, size, polyline, topPadding, bottomPadding, showPlaceNamesInTooltip, noticeHeight, service, showMotorcycleNotice, vehicleLatitude, vehicleLongitude]);

  useEffect(() => {
    fit(false);
  }, [fit]);

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
        label={showPlaceNamesInTooltip ? `Origen: ${getPlaceStreetName(origin)}` : 'Origen'}
      />
      <RoutePinMarker
        kind="B"
        coordinate={destination.coordinates}
        route={polyline}
        mapBearing={mapBearing}
        mapZoom={mapZoom}
        label={showPlaceNamesInTooltip ? `Destino: ${getPlaceStreetName(destination)}` : 'Destino'}
      />
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
