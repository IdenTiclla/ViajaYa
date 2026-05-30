/**
 * Tipos del dominio de reserva (booking).
 *
 * Un `Place` es un punto del viaje (origen o destino): sus coordenadas y una
 * etiqueta legible (nombre + dirección) obtenida por geocodificación inversa.
 */
import type { Coordinates } from '@/features/home/data/locationService';

export type { Coordinates };

export type Place = {
  coordinates: Coordinates;
  /** Nombre corto del lugar (p. ej. "Aeropuerto Internacional"). */
  name: string;
  /** Dirección secundaria legible. */
  address: string;
};

/**
 * Predicción de la búsqueda de lugares (autocompletado). Aún no tiene
 * coordenadas: estas se resuelven al seleccionarla (place details), para no
 * gastar una petición de detalle por cada sugerencia listada.
 */
export type PlaceSuggestion = {
  /** Identificador de Google Places, usado para resolver las coordenadas. */
  placeId: string;
  /** Texto principal (p. ej. "Plaza Murillo"). */
  name: string;
  /** Texto secundario (ciudad, región…). */
  address: string;
};

/** Categoría de un lugar guardado; determina el ícono mostrado. */
export type SavedPlaceCategory = 'home' | 'work' | 'gym' | 'other';

/**
 * Lugar favorito del pasajero, persistido en el backend para que sincronice
 * entre dispositivos. `place` es el punto (coordenadas + etiquetas) y `label`
 * el nombre que pone el usuario.
 */
export type SavedPlace = {
  id: string;
  label: string;
  category: SavedPlaceCategory;
  place: Place;
};

/** Tipo de servicio solicitado. */
export type ServiceType = 'taxi' | 'moto';

/** Forma de pago elegida para el viaje. Por ahora: QR o efectivo. */
export type PaymentMethod = 'qr' | 'cash';
