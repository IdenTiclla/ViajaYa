/** Coordenadas geográficas compartidas entre los distintos features. */
export type Coordinates = {
  latitude: number;
  longitude: number;
};

/** Etiqueta legible asociada a un punto geográfico. */
export type PlaceLabel = {
  name: string;
  address: string;
  countryCode: string | null;
};
