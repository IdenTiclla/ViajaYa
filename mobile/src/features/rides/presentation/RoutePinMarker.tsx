/**
 * Reusable route marker: circular A (origin) and B (destination) pins
 * and an "Origen"/"Destino" tooltip on the free side of the route. Used by the
 * route views (passenger and driver) so origin and destination always look the same.
 *
 * The tooltip is laid out in flow (not absolute) so it renders reliably inside
 * the marker on iOS and Android; the `anchor` points at the pin (not at the center of
 * the group) so the point sits exactly on the coordinate.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';

import { fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';
import { MapPointBadge } from '@/shared/components/map/MapPointBadge';
import {
  ROUTE_PIN_BORDER,
  computePinAnchor,
  chooseTooltipPlacement,
  scheduleMarkerRedraw,
  projectRouteRelativeToPin,
  TOOLTIP_SEPARATION,
  ROUTE_PIN_LETTER_SIZE,
  ROUTE_PIN_SIZE,
  placeTooltipClearOfRoute,
  type LabelSize,
} from '@/features/rides/presentation/routeTooltipLayout';

type Props = {
  kind: 'A' | 'B';
  coordinate: Coordinates;
  /** Texto del tooltip (p. ej. "Origen", "Destino"). */
  label: string;
  /** Visible route: lets the label move away from the route next to the pin. */
  route?: readonly Coordinates[];
  /** Current camera bearing, in degrees. */
  mapBearing?: number;
  /** Google Maps zoom to compare the text size with the route. */
  mapZoom?: number;
  /** Hide the tooltip when the information is shown outside the map. */
  showTooltip?: boolean;
  /** Show an edit control attached to the marker. */
  showEditControl?: boolean;
  /** Dim the pin (e.g. unselected origins on the requests map). */
  dim?: boolean;
  /** Marker stacking order when several points overlap. */
  zIndex?: number;
  /** Signals that this point's name is still being resolved. */
  loading?: boolean;
  onPress?: () => void;
  /** Reports the measured label block so the camera can frame it. */
  onLabelSize?: (size: LabelSize) => void;
};

const EMPTY_ROUTE: readonly Coordinates[] = [];

export function RoutePinMarker({
  kind,
  coordinate,
  label,
  route = EMPTY_ROUTE,
  mapBearing = 0,
  mapZoom,
  showTooltip = true,
  showEditControl,
  dim,
  zIndex,
  loading = false,
  onPress,
  onLabelSize,
}: Props) {
  const { colors, styles, mode } = useThemedStyles(createStyles);
  const marker = useRef<MapMarker>(null);
  const [size, setSize] = useState({ width: 0, height: ROUTE_PIN_SIZE });
  const [labelSize, setLabelSize] = useState({
    width: 178, height: showEditControl ? 70 : 40,
  });
  const hasLabels = Boolean(showTooltip || showEditControl);
  const location = useMemo(() => {
    const preferred = chooseTooltipPlacement(kind, coordinate, route, mapBearing);
    if (!hasLabels || mapZoom == null) {
      return { placement: preferred, separation: TOOLTIP_SEPARATION, visible: true };
    }
    return placeTooltipClearOfRoute(
      projectRouteRelativeToPin(coordinate, route, mapBearing, mapZoom),
      labelSize, preferred,
    );
  }, [kind, coordinate, route, mapBearing, mapZoom, hasLabels, labelSize]);
  const { placement, separation, visible } = location;
  useEffect(() => scheduleMarkerRedraw(() => marker.current?.redraw()), [
    size.width, size.height, label, kind, placement, showTooltip,
    showEditControl, loading, dim, separation, visible, mode,
  ]);

  return (
    <Marker
      ref={marker}
      coordinate={coordinate}
      // On Google Maps Android polylines and markers are separate
      // layers; an explicit z-index keeps the pin visible above the route.
      zIndex={zIndex ?? 10}
      anchor={computePinAnchor(size.height, placement)}
      accessibilityLabel={label}
      title={!visible ? label : undefined}
      onPress={onPress}>
      <View
        // Fabric must not flatten this container: Android measures the first native
        // child to size the whole bitmap (text, Editar and symbol).
        collapsable={false}
        style={[styles.wrap, placement === 'below' && styles.wrapBelow]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize((current) => current.width === width && current.height === height
            ? current
            : { width, height });
        }}>
        <View
          style={[
            styles.labels,
            placement === 'below' && styles.wrapBelow,
            {
              opacity: visible ? 1 : 0,
              marginTop: hasLabels && placement === 'below' ? separation : 0,
              marginBottom: hasLabels && placement === 'above' ? separation : 0,
            },
          ]}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setLabelSize((current) => current.width === width && current.height === height
              ? current : { width, height });
            onLabelSize?.({ width, height });
          }}>
          {showEditControl && (
            <View
              style={[
                styles.editControl,
                kind === 'A' ? styles.editOrigin : styles.editDestination,
              ]}>
              <Ionicons name="create" size={11} color={colors.textOnPrimary} />
              <Text style={styles.editText}>Editar</Text>
            </View>
          )}
          {showTooltip && (
            <View style={styles.tooltip}>
              <Text
                numberOfLines={2}
                ellipsizeMode="tail"
                style={styles.tooltipText}>
                {label}
              </Text>
            </View>
          )}
        </View>
        <MapPointBadge
          kind={kind === 'A' ? 'origin' : 'destination'}
          size={ROUTE_PIN_SIZE}
          border={ROUTE_PIN_BORDER}
          letterSize={ROUTE_PIN_LETTER_SIZE}
          loading={loading}
          dimmed={dim}
        />
      </View>
    </Marker>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { alignItems: 'center' },
  labels: { alignItems: 'center', gap: spacing.sm },
  wrapBelow: { flexDirection: 'column-reverse' },
  editControl: {
    width: 56,
    height: 22,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 2,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  editOrigin: { backgroundColor: colors.primary },
  editDestination: { backgroundColor: colors.danger },
  editText: { color: colors.textOnPrimary, fontSize: 9, fontWeight: fontWeight.bold },
  tooltip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  tooltipText: {
    maxWidth: 160,
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
});
