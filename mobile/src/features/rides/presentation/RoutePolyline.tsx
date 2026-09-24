/**
 * Route visual shared by the passenger and driver maps.
 * The light outline keeps the route readable over streets and labels.
 */
import { Fragment } from 'react';
import { Polyline } from 'react-native-maps';

import { useTema } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';
import {
  ANCHO_CONTORNO_RUTA,
  ANCHO_RUTA,
} from '@/features/rides/presentation/routeTooltipLayout';

export function RoutePolyline({ coordinates }: { coordinates: Coordinates[] }) {
  const { colors } = useTema();
  if (coordinates.length < 2) return null;

  return (
    <Fragment>
      <Polyline
        coordinates={coordinates}
        strokeColor={colors.surface}
        strokeWidth={ANCHO_CONTORNO_RUTA}
        zIndex={1}
      />
      <Polyline
        coordinates={coordinates}
        strokeColor={colors.primary}
        strokeWidth={ANCHO_RUTA}
        zIndex={2}
      />
    </Fragment>
  );
}
