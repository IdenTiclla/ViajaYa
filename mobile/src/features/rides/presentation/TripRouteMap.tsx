/**
 * Mapa de fondo del viaje en curso: dibuja el trayecto origen→destino por calles
 * (cae a línea recta si no hay ruta) y reencuadra para que quepan ambos puntos.
 * Reutilizado por las vistas de seguimiento del pasajero y de navegación del conductor.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { getPlaceStreetName } from '@/features/booking/domain/placeLabels';
import type { Coordinates, Place } from '@/features/booking/domain/types';
import { useRoute } from '@/features/booking/application/useRoute';
import { declutteredMapStyle } from '@/features/booking/presentation/mapStyle';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';
import { RoutePolyline } from '@/features/rides/presentation/RoutePolyline';
import { MARGEN_TOOLTIP_RUTA } from '@/features/rides/presentation/routeTooltipLayout';
import { useRumboMapa } from '@/features/rides/application/useRumboMapa';

export function TripRouteMap({
  origin,
  destination,
  topPadding = 120,
  bottomPadding = 320,
  showPlaceNamesInTooltip = false,
}: {
  origin: Place;
  destination: Place;
  topPadding?: number;
  bottomPadding?: number;
  /** Muestra el nombre de cada lugar dentro del tooltip de sus marcadores. */
  showPlaceNamesInTooltip?: boolean;
}) {
  const mapRef = useRef<MapView>(null);
  const { rumboMapa, zoomMapa, actualizarRumbo } = useRumboMapa(mapRef);
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
    // `fitToCoordinates` solo considera las coordenadas de los pines, no las
    // vistas personalizadas de sus tooltips. Reservamos ese espacio para que
    // los nombres de origen y destino no se recorten contra los bordes.
    const tooltipInset = MARGEN_TOOLTIP_RUTA;
    const tooltipSideInset = showPlaceNamesInTooltip ? 88 : 50;
    mapRef.current?.fitToCoordinates(polyline, {
      edgePadding: {
        top: topPadding + tooltipInset,
        right: tooltipSideInset,
        bottom: bottomPadding + tooltipInset,
        left: tooltipSideInset,
      },
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
      // La proyección de colisiones comparte la vista cenital del trayecto.
      pitchEnabled={false}
      onMapReady={() => fit(false)}
      onRegionChangeComplete={actualizarRumbo}
      // En algunos Android el mapa queda listo antes de recibir su tamaño final.
      // Reencuadrar tras el layout mantiene el trayecto centrado al navegar.
      onLayout={() => fit(false)}>
      <RoutePinMarker
        kind="A"
        coordinate={origin.coordinates}
        ruta={polyline}
        rumboMapa={rumboMapa}
        zoomMapa={zoomMapa}
        label={showPlaceNamesInTooltip ? `Origen: ${getPlaceStreetName(origin)}` : 'Origen'}
      />
      <RoutePinMarker
        kind="B"
        coordinate={destination.coordinates}
        ruta={polyline}
        rumboMapa={rumboMapa}
        zoomMapa={zoomMapa}
        label={showPlaceNamesInTooltip ? `Destino: ${getPlaceStreetName(destination)}` : 'Destino'}
      />
      <RoutePolyline coordinates={polyline} />
    </MapView>
  );
}
