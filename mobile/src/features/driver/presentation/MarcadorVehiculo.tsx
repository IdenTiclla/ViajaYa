import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';
import { useReducedMotion } from 'react-native-reanimated';

import type { Coordinates } from '@/core/domain/geo';
import { useThemedStyles, type Theme } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';
import { MapVehicle } from '@/shared/components/mapa/VehiculoMapa';
import { scheduleMarkerRedraw } from '@/features/rides/presentation/routeTooltipLayout';
import { computeVehicleRotation, isValidHeading } from './rumboVehiculo';

type Props = {
  label?: string;
  opacity?: number;
  coordinates: Coordinates;
  heading: number | null;
  vehicleType: VehicleType | null;
};

/** Position and rotation belong to the native map, not to a screen overlay. */
export function VehicleMarker({ coordinates, heading, vehicleType, label, opacity = 1 }: Props) {
  const { styles, mode } = useThemedStyles(createStyles);
  const marker = useRef<MapMarker>(null);
  const oriented = isValidHeading(heading) && vehicleType != null;
  const hasVehicle = vehicleType != null;
  const [rotation, setRotation] = useState(isValidHeading(heading) ? heading : 0);
  const visibleAngle = useRef(rotation);
  const hadHeading = useRef(isValidHeading(heading));
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!isValidHeading(heading)) { hadHeading.current = false; return; }
    const previous = visibleAngle.current;
    const next = computeVehicleRotation(previous, heading);
    const duration = hadHeading.current && !reduceMotion ? 180 : 0;
    hadHeading.current = true;
    let startTime: number | null = null;
    let frame: number;
    const animate = (instant: number) => {
      startTime ??= instant;
      const progress = duration ? Math.min(1, (instant - startTime) / duration) : 1;
      const angle = previous + (next - previous) * (1 - (1 - progress) ** 3);
      visibleAngle.current = angle;
      setRotation(angle);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [heading, reduceMotion]);
  useEffect(() => scheduleMarkerRedraw(() => marker.current?.redraw()), [mode, vehicleType, oriented]);

  const defaultLabel = oriented
    ? `Tu ${vehicleType === 'moto' ? 'moto' : 'taxi'}`
    : 'Tu ubicación, orientación no disponible';
  // Rotating only changes a native property: it keeps the drawing's tree.
  const content = useMemo(() => (
    <View collapsable={false} style={styles.frame}>
      {/* Both slots stay mounted to keep the Fabric bitmap stable. */}
      <View style={[styles.vehicle, { opacity: hasVehicle ? 1 : 0 }]}>
        <MapVehicle kind={vehicleType ?? 'taxi'} />
        <View style={[styles.front, { opacity: oriented ? 1 : 0 }]} />
      </View>
      <View style={[styles.noHeading, { opacity: hasVehicle ? 0 : 1 }]} />
    </View>
  ), [styles, oriented, hasVehicle, vehicleType]);
  return (
    <Marker
      ref={marker}
      coordinate={coordinates}
      rotation={rotation}
      flat
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={30}
      opacity={opacity}
      title={label ?? defaultLabel}
      accessibilityLabel={label ?? defaultLabel}>
      {content}
    </Marker>
  );
}

// Compact marker: the vehicle drawing sits directly on the street, no background disc.
const createStyles = ({ colors }: Theme) => StyleSheet.create({
  frame: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  vehicle: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  front: {
    position: 'absolute', top: 0, width: 0, height: 0,
    borderLeftWidth: 3, borderRightWidth: 3, borderBottomWidth: 4,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: colors.vehicleOutline,
  },
  noHeading: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7, borderWidth: 2.5,
    borderColor: colors.vehicleReflection, backgroundColor: colors.vehicleOutline,
  },
});
