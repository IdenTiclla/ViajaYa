/**
 * "Decluttered" map style for the route view: hides the labels
 * and icons of POIs/businesses and transit, which Google draws above the
 * polyline and make the route hard to see. Keeps streets and their names.
 *
 * Only applies with `PROVIDER_GOOGLE` and without a cloud Map ID.
 */
import type { MapStyleElement } from 'react-native-maps';
import { useMemo } from 'react';

import { useTheme } from '@/core/theme';

export const declutteredMapStyle: MapStyleElement[] = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

/** Also pin the map to the chosen theme, keeping control over places. */
export function useMapStyle(hidePlaces = true) {
  const { colors, mode } = useTheme();
  const mapStyle = useMemo<MapStyleElement[]>(() => [
    { elementType: 'geometry', stylers: [{ color: colors.mapLand }] },
    // Hide zoom-dependent footprints and relief instead of only tinting them.
    // Place names remain independent from these geometry layers.
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'landscape.natural.terrain', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: colors.mapLabel }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: colors.mapOutline }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: colors.mapStreet }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: colors.mapMainRoad }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: colors.mapWater }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: colors.mapPark }] },
    ...(hidePlaces ? declutteredMapStyle : []),
  ], [colors, hidePlaces]);
  return { mapStyle, mapMode: mode };
}
