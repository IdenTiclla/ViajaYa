/**
 * Booking domain types.
 *
 * A `Place` is a point of the ride (origin or destination): its coordinates and a
 * human-readable label (name + address) obtained through reverse geocoding.
 */
import type { Coordinates } from '@/core/domain/geo';

export type { Coordinates } from '@/core/domain/geo';

export type Place = {
  coordinates: Coordinates;
  /** Nombre corto del lugar (p. ej. "Aeropuerto Internacional"). */
  name: string;
  /** Human-readable secondary address. */
  address: string;
  /** ISO 3166-1 alpha-2 code when the source can determine it. */
  countryCode: string | null;
  /** Mobile only: the coordinates are already chosen, but a readable label is missing. */
  labelStatus?: 'provisional';
};

/**
 * Place search prediction (autocomplete). It has no
 * coordinates yet: they are resolved on selection (place details), so a
 * details request is not spent on every listed suggestion.
 */
export type PlaceSuggestion = {
  /** Google Places identifier, used to resolve the coordinates. */
  placeId: string;
  /** Texto principal (p. ej. "Plaza Murillo"). */
  name: string;
  /** Secondary text (city, region…). */
  address: string;
};

/** Category of a saved place; sets the icon shown. */
export type SavedPlaceCategory = 'home' | 'work' | 'gym' | 'other';

/**
 * The passenger's favorite place, persisted in the backend so it syncs
 * across devices. `place` is the point (coordinates + labels) and `label`
 * the name the user gives it.
 */
export type SavedPlace = {
  id: string;
  label: string;
  category: SavedPlaceCategory;
  place: Place;
};

/** Tipo de servicio solicitado (`moving` = mudanza con camioneta). */
export type ServiceType = 'taxi' | 'moto' | 'delivery' | 'moving';

/** Payment method chosen for the ride. For now: QR or cash. */
export type PaymentMethod = 'qr' | 'cash';
