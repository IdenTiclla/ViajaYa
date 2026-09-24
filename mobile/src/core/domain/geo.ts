/** Geographic coordinates shared across features. */
export type Coordinates = {
  latitude: number;
  longitude: number;
};

/** Human-readable label attached to a geographic point. */
export type PlaceLabel = {
  name: string;
  address: string;
  countryCode: string | null;
};
