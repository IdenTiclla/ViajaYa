/**
 * Route visual shared by the passenger and driver maps.
 * The light outline keeps the route readable over streets and labels.
 */
import { Fragment } from 'react';
import { Polyline } from 'react-native-maps';

import { useTheme } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';
import {
  ROUTE_OUTLINE_WIDTH,
  ROUTE_WIDTH,
} from '@/features/rides/presentation/routeTooltipLayout';

export function RoutePolyline({ coordinates }: { coordinates: Coordinates[] }) {
  const { colors } = useTheme();
  if (coordinates.length < 2) return null;

  return (
    <Fragment>
      <Polyline
        coordinates={coordinates}
        strokeColor={colors.surface}
        strokeWidth={ROUTE_OUTLINE_WIDTH}
        zIndex={1}
      />
      <Polyline
        coordinates={coordinates}
        strokeColor={colors.primary}
        strokeWidth={ROUTE_WIDTH}
        zIndex={2}
      />
    </Fragment>
  );
}
