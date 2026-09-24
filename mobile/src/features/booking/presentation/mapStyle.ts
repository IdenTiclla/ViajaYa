/**
 * "Decluttered" map style for the route view: hides the labels
 * and icons of POIs/businesses and transit, which Google draws above the
 * polyline and make the route hard to see. Keeps streets and their names.
 *
 * Only applies with `PROVIDER_GOOGLE` and without a cloud Map ID.
 */
import type { MapStyleElement } from 'react-native-maps';
import { useMemo } from 'react';

import { useTema } from '@/core/theme';

export const declutteredMapStyle: MapStyleElement[] = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

/** Also pin the map to the chosen theme, keeping control over places. */
export function useEstiloMapa(ocultarLugares = true) {
  const { colors, modo } = useTema();
  const estiloMapa = useMemo<MapStyleElement[]>(() => [
    { elementType: 'geometry', stylers: [{ color: colors.mapaTierra }] },
    // Hide zoom-dependent footprints and relief instead of only tinting them.
    // Place names remain independent from these geometry layers.
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'landscape.natural.terrain', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: colors.mapaEtiqueta }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: colors.mapaContorno }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: colors.mapaCalle }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: colors.mapaPrincipal }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: colors.mapaAgua }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: colors.mapaParque }] },
    ...(ocultarLugares ? declutteredMapStyle : []),
  ], [colors, ocultarLugares]);
  return { estiloMapa, modoMapa: modo };
}
