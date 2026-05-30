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

/** Tipo de servicio solicitado. */
export type ServiceType = 'taxi' | 'moto';
