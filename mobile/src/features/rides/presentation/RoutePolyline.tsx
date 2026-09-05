/**
 * Trayecto visual compartido por los mapas de pasajero y conductor.
 * El contorno claro mantiene la ruta legible sobre calles y etiquetas.
 */
import { Fragment } from 'react';
import { Polyline } from 'react-native-maps';

import { colors } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';

export function RoutePolyline({ coordinates }: { coordinates: Coordinates[] }) {
  if (coordinates.length < 2) return null;

  return (
    <Fragment>
      <Polyline
        coordinates={coordinates}
        strokeColor={colors.surface}
        strokeWidth={9}
        zIndex={1}
      />
      <Polyline
        coordinates={coordinates}
        strokeColor={colors.primary}
        strokeWidth={5}
        zIndex={2}
      />
    </Fragment>
  );
}
