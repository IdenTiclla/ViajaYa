/**
 * Mapa de fondo del conductor "buscando solicitudes": siempre un `MapView` de
 * Google que **sigue al conductor** (lo mantiene centrado mientras se mueve por
 * la ciudad, como un navegador). El ícono del conductor y las ondas se dibujan
 * aparte (overlay centrado), por lo que aquí no hay marker del conductor.
 *
 * La posición llega en vivo desde `useWatchPosition` (el padre); este componente
 * solo re-centra el mapa con cada actualización.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { declutteredMapStyle } from '@/features/booking/presentation/mapStyle';
import type { Coordinates } from '@/features/home/data/locationService';
import type { WatchStatus } from '@/features/home/application/useWatchPosition';

// Zoom de navegación urbano: muestra unas manzanas alrededor del conductor.
const FOLLOW_DELTA = 0.012;

// Región por defecto (centro de La Paz) antes de tener la ubicación.
const DEFAULT_REGION: Region = {
  latitude: -16.5,
  longitude: -68.15,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

type Props = {
  coordinates: Coordinates | null;
  status: WatchStatus;
  retry: () => void;
};

export function DriverSearchMap({ coordinates, status, retry }: Props) {
  const mapRef = useRef<MapView>(null);

  const region: Region = coordinates
    ? {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        latitudeDelta: FOLLOW_DELTA,
        longitudeDelta: FOLLOW_DELTA,
      }
    : DEFAULT_REGION;

  // Sigue al conductor: re-centra con cada nueva posición.
  useEffect(() => {
    if (!coordinates) return;
    mapRef.current?.animateToRegion(
      {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        latitudeDelta: FOLLOW_DELTA,
        longitudeDelta: FOLLOW_DELTA,
      },
      500,
    );
  }, [coordinates]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        customMapStyle={declutteredMapStyle}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
      />

      {(status === 'denied' || status === 'error') && (
        <View style={styles.permissionOverlay} pointerEvents="box-none">
          <View style={styles.permissionCard}>
            <Ionicons name="location-outline" size={28} color={colors.primary} />
            <Text style={styles.permissionText}>
              {status === 'denied'
                ? 'Activa tu ubicación para seguir tu ubicación y recibir solicitudes cercanas.'
                : 'No pudimos obtener tu ubicación.'}
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel="Reintentar obtención de ubicación">
              <Text style={styles.retryBtnText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  permissionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  permissionCard: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  permissionText: {
    fontSize: fontSize.sm,
    color: colors.text,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  retryBtnText: { color: colors.textOnPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
