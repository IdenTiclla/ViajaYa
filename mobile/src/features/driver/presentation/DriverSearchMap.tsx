/**
 * Driver request map: the camera follows GPS with gestures locked. The radar
 * shares the vehicle's native screen projection.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useMapStyle } from '@/features/booking/presentation/mapStyle';
import type { VehicleType } from '@/features/auth/domain/types';
import type { Coordinates } from '@/core/domain/geo';
import type { WatchStatus } from '@/features/home/application/useWatchPosition';
import { VehicleMarker } from './VehicleMarker';
import { RadarPulse } from './RadarPulse';
import { useDriverMapCamera } from './useDriverMapCamera';

// Urban navigation zoom: shows a few blocks around the driver.
const FOLLOW_DELTA = 0.012;

type Props = {
  coordinates: Coordinates | null;
  heading: number | null;
  vehicleType: VehicleType | null;
  status: WatchStatus;
  retry: () => void;
  showRadar?: boolean;
};

export function DriverSearchMap(props: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const { coordinates, status, retry } = props;
  if (coordinates) return <LocatedMap {...props} coordinates={coordinates} />;

  const loading = status === 'loading';
  const openSettings = status === 'denied' || status === 'disabled';
  const message = loading ? 'Buscando tu ubicación…'
    : status === 'disabled' ? 'La ubicación del teléfono está desactivada.'
      : status === 'denied' ? 'Permite el acceso a tu ubicación para mostrarte en el mapa.'
        : 'Todavía no recibimos tu ubicación. Comprueba la señal y que la ubicación esté activada.';
  const configure = () => {
    if (status === 'disabled' && Platform.OS === 'android') {
      void Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings());
    } else {
      void Linking.openSettings();
    }
  };
  // Do not show a fixed city as if it were the driver's location.
  return (
    <View style={styles.container}>
      <View style={styles.permissionOverlay}>
        <View style={styles.permissionCard}>
          {loading ? <ActivityIndicator color={colors.primary} size="large" />
            : <Ionicons name="location-outline" size={28} color={colors.primary} />}
          <Text style={styles.permissionText} accessibilityLiveRegion="polite">{message}</Text>
          {!loading && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={openSettings ? configure : retry}
              accessibilityRole="button"
              accessibilityLabel={openSettings ? 'Abrir configuración de ubicación' : 'Reintentar ubicación'}>
              <Text style={styles.retryBtnText}>{openSettings ? 'Abrir configuración' : 'Reintentar'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function LocatedMap({ coordinates, heading, vehicleType, showRadar = false }: Props & { coordinates: Coordinates }) {
  const { styles } = useThemedStyles(createStyles);
  const mapRef = useRef<MapView>(null);
  const { mapStyle, mapMode } = useMapStyle(true);
  const [ready, setReady] = useState(false);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const { radarPoint, updateRadarPosition } = useDriverMapCamera(mapRef, coordinates, ready, layout.width, layout.height);
  const radarSize = Math.min(365, layout.width, layout.height);

  const region: Region = {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    latitudeDelta: FOLLOW_DELTA,
    longitudeDelta: FOLLOW_DELTA,
  };

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent: { layout: size } }) => {
        setLayout((current) => current.width === size.width && current.height === size.height
          ? current : { width: size.width, height: size.height });
      }}>
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
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        zoomTapEnabled={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        pitchEnabled={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        onMapReady={() => setReady(true)}
        onRegionChangeComplete={updateRadarPosition}>
        <VehicleMarker coordinates={coordinates} heading={heading} vehicleType={vehicleType} />
      </MapView>

      {showRadar && radarPoint && <View testID="driver-location-radar" pointerEvents="none" style={{ position: 'absolute',
        left: radarPoint.x - radarSize / 2, top: radarPoint.y - radarSize / 2 }}>
        <RadarPulse size={radarSize} />
      </View>}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  retryBtnText: { color: colors.textOnPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
