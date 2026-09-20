import type { Ride } from '@/features/rides/domain/types';

export function navigationTarget(ride: Ride | null | undefined) {
  if (!ride || !['accepted', 'arriving', 'in_progress'].includes(ride.status)) return null;
  const stage = ride.status === 'in_progress' ? 'destination' : 'pickup';
  const place = stage === 'pickup' ? ride.origin : ride.destination;
  if (!Number.isFinite(place.coordinates.latitude) || !Number.isFinite(place.coordinates.longitude)
    || Math.abs(place.coordinates.latitude) > 90 || Math.abs(place.coordinates.longitude) > 180) return null;
  return { rideId: ride.id, stage, place,
    motorcycle: ride.service === 'moto' || ride.driver?.vehicleType === 'moto',
    label: stage === 'pickup' ? 'Ir a la recogida' : 'Ir al destino',
    key: `${ride.id}:${stage}:${place.coordinates.latitude}:${place.coordinates.longitude}:${ride.driver?.vehicleType ?? ride.service}` };
}
export type NavigationTarget = NonNullable<ReturnType<typeof navigationTarget>>;

export function wazeLinks(target: NavigationTarget) {
  const coordinate = `${target.place.coordinates.latitude},${target.place.coordinates.longitude}`;
  return { app: `waze://?ll=${coordinate}&navigate=yes&utm_source=viajaya`,
    web: `https://waze.com/ul?ll=${coordinate}&navigate=yes&utm_source=viajaya` };
}

export function navigationErrorMessage(status: string): string {
  switch (status) {
    case 'notAuthorized': return 'El servicio de navegación integrada no está habilitado. Puedes usar Waze.';
    case 'QUOTA_CHECK_FAILED': return 'El servicio de navegación integrada alcanzó su límite. Puedes usar Waze.';
    case 'locationPermissionMissing': case 'LOCATION_DISABLED':
      return 'Activa la ubicación y permite que ViajaYa la utilice para navegar.';
    case 'LOCATION_UNKNOWN': return 'Aún no tenemos una señal GPS precisa. Reintenta en un lugar abierto.';
    case 'termsNotAccepted': return 'Acepta las condiciones de navegación para iniciar las indicaciones.';
    case 'NO_ROUTE_FOUND': return 'No encontramos una ruta para este vehículo. Revisa el punto o abre Waze.';
    case 'NETWORK_ERROR': case 'networkError': return 'El servicio de navegación no respondió. Puedes reintentar o abrir Waze.';
    default: return 'No pudimos iniciar las indicaciones. Reintenta o abre Waze.';
  }
}
