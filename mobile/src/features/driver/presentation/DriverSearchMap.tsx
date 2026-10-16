/**
 * Driver request map: the camera follows GPS with gestures locked. The radar
 * shares the vehicle's native screen projection.
 */
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useMapStyle } from '@/features/booking/presentation/mapStyle';
import type { VehicleType } from '@/features/auth/domain/types';
import type { Coordinates } from '@/core/domain/geo';
import type { WatchStatus } from '@/features/home/application/useWatchPosition';
import { LocatingChip } from '@/features/location/presentation/LocatingChip';
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
  showRadar?: boolean;
};

export function DriverSearchMap(props: Props) {
  const { styles } = useThemedStyles(createStyles);
  const { coordinates, status } = props;
  if (coordinates) return <LocatedMap {...props} coordinates={coordinates} />;

  // Do not show a fixed city as if it were the driver's location. The permission and the
  // location switch are the gate's job; here the wait is only a passive status.
  return (
    <View style={styles.container}>
      <View style={styles.permissionOverlay} pointerEvents="none">
        <LocatingChip
          phase={status === 'weak' ? 'weak' : 'locating'}
          style={styles.waitingChip}
        />
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
  waitingChip: { left: spacing.xl, right: spacing.xl },
});
