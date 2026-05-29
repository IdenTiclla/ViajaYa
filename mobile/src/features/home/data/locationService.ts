/**
 * Acceso a la ubicación del dispositivo (expo-location) detrás de un puerto
 * sencillo, para aislar la UI del SDK y poder mockearlo en tests.
 */
import * as Location from 'expo-location';

export type Coordinates = { latitude: number; longitude: number };

export type LocationResult =
  | { status: 'granted'; coordinates: Coordinates }
  | { status: 'denied' };

export const locationService = {
  /**
   * Solicita el permiso de ubicación en uso y devuelve la posición actual.
   * Si el usuario lo deniega, regresa `{ status: 'denied' }` (sin lanzar).
   */
  async getCurrentLocation(): Promise<LocationResult> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      return { status: 'denied' };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      status: 'granted',
      coordinates: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
    };
  },
};
