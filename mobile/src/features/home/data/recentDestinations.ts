/**
 * Destinos recientes (mock). El historial real llega en una entrega posterior;
 * por ahora alimenta la lista del Home para fidelidad con el diseño.
 */
export type RecentDestination = {
  id: string;
  name: string;
  address: string;
};

export const recentDestinations: RecentDestination[] = [
  { id: '1', name: 'Aeropuerto Internacional', address: 'Av. Costanera, Zona Norte' },
  { id: '2', name: 'Plaza Principal', address: 'Centro, Casco Viejo' },
];
