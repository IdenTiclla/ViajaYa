/**
 * Estilo de mapa "decluttered" para la vista del trayecto: oculta las etiquetas
 * e íconos de POI/negocios y de transporte, que Google dibuja por encima de la
 * polilínea y dificultan ver la ruta. Conserva las calles y sus nombres.
 *
 * Solo aplica con `PROVIDER_GOOGLE` y sin un Map ID en la nube.
 */
import type { MapStyleElement } from 'react-native-maps';

export const declutteredMapStyle: MapStyleElement[] = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
