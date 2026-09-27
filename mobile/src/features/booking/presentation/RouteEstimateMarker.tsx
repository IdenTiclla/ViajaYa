/**
 * Route estimate bubble on the trip configuration map: travel time, distance and
 * the arrival time, anchored halfway along the road route with a pointer below.
 *
 * It uses the brand blue in both themes (like the wordmark) so the yellow
 * distance keeps its contrast. The bitmap is redrawn with the same two-step
 * technique as RoutePinMarker, because Android can capture it before the text lays out.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';

import { fontSize, fontWeight, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBrandFontStyle } from '@/core/theme/brandFont';
import type { Coordinates } from '@/features/booking/domain/types';
import {
  formatArrivalTime,
  formatRouteDistance,
  formatRouteDuration,
} from '@/features/booking/domain/routeEstimate';
import {
  scheduleMarkerRedraw,
  type LabelSize,
} from '@/features/rides/presentation/routeTooltipLayout';

type Props = {
  coordinate: Coordinates;
  distanceMeters: number;
  durationSeconds: number;
  /** Reports the measured bubble (pointer included) so the camera can frame it. */
  onSize?: (size: LabelSize) => void;
};

const POINTER = 12;
const LATE_REDRAW_MS = 400;
const CLOCK_TICK_MS = 30_000;

export function RouteEstimateMarker({ coordinate, distanceMeters, durationSeconds, onSize }: Props) {
  const { colors, styles, mode } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  const marker = useRef<MapMarker>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const duration = formatRouteDuration(durationSeconds);
  const distance = formatRouteDistance(distanceMeters);
  const arrival = formatArrivalTime(now, durationSeconds);
  const redrawKey = [duration, distance, arrival, mode, brandFont ? 'brand' : 'system'].join('|');
  useEffect(() => scheduleMarkerRedraw(() => marker.current?.redraw()), [redrawKey]);
  useEffect(() => {
    const timer = setTimeout(() => marker.current?.redraw(), LATE_REDRAW_MS);
    return () => clearTimeout(timer);
  }, [redrawKey]);

  return (
    <Marker
      ref={marker}
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 1 }}
      zIndex={15}
      tappable={false}
      accessibilityLabel={`Viaje estimado: ${duration}, ${distance}. Llegas a las ${arrival}`}>
      <View
        collapsable={false}
        style={styles.wrap}
        onLayout={({ nativeEvent: { layout } }) => onSize?.({ width: layout.width, height: layout.height })}>
        <View style={styles.bubble}>
          <View style={styles.mainRow}>
            <Text style={[styles.duration, brandFont]}>{duration}</Text>
            <Text style={styles.distance}>{distance}</Text>
          </View>
          <View style={styles.arrivalRow}>
            <Ionicons name="flag" size={12} color={colors.accent} />
            <Text style={styles.arrival}>
              Llegas a las <Text style={styles.arrivalTime}>{arrival}</Text>
            </Text>
          </View>
        </View>
        <View style={styles.pointer} />
      </View>
    </Marker>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  // The rotated pointer's tip reaches half a diagonal below the bubble; ending the
  // bitmap exactly there puts the bottom-center anchor on the route.
  wrap: {
    alignItems: 'center',
    paddingBottom: (Math.SQRT2 * POINTER) / 2 - POINTER / 2,
    paddingHorizontal: 6,
    paddingTop: 2,
  },
  bubble: {
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm + 2,
    borderRadius: 16,
    backgroundColor: colors.brand,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  mainRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  duration: { fontSize: 24, fontWeight: fontWeight.bold, color: colors.textOnBrand },
  distance: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.accent },
  arrivalRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrival: { fontSize: fontSize.xs, color: colors.textOnBrand, opacity: 0.85 },
  arrivalTime: { fontWeight: fontWeight.bold, opacity: 1 },
  pointer: {
    width: POINTER,
    height: POINTER,
    marginTop: -POINTER / 2,
    backgroundColor: colors.brand,
    transform: [{ rotate: '45deg' }],
  },
});
