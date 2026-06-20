/**
 * Mapa de fondo del viaje en curso: dibuja el trayecto origen→destino por calles
 * (cae a línea recta si no hay ruta) y reencuadra para que quepan ambos puntos.
 * Reutilizado por las vistas de seguimiento del pasajero y de navegación del conductor.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { colors } from '@/core/theme';
import type { Coordinates, Place } from '@/features/booking/domain/types';
import { useRoute } from '@/features/booking/application/useRoute';
import { declutteredMapStyle } from '@/features/booking/presentation/mapStyle';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';

export function TripRouteMap({
  origin,
  destination,
  topPadding = 120,
  bottomPadding = 320,
}: {
  origin: Place;
  destination: Place;
  topPadding?: number;
  bottomPadding?: number;
}) {
  const mapRef = useRef<MapView>(null);
  const { route } = useRoute(origin, destination);

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

  const polyline: Coordinates[] = route?.coordinates.length
    ? route.coordinates
    : [origin.coordinates, destination.coordinates];

  const fit = (animated: boolean) => {
    if (polyline.length < 2) return;
    mapRef.current?.fitToCoordinates(polyline, {
      edgePadding: { top: topPadding, right: 50, bottom: bottomPadding, left: 50 },
      animated,
    });
  };

  useEffect(() => {
    fit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyline.length, bottomPadding, topPadding]);

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      customMapStyle={declutteredMapStyle}
      onMapReady={() => fit(false)}>
      <RoutePinMarker kind="A" coordinate={origin.coordinates} label="Origen" />
      <RoutePinMarker kind="B" coordinate={destination.coordinates} label="Destino" />
      {polyline.length >= 2 && (
        <>
          <Polyline coordinates={polyline} strokeColor={colors.surface} strokeWidth={9} />
          <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={5} />
        </>
      )}
    </MapView>
  );
}
