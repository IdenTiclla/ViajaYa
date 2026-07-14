import { Stack, useGlobalSearchParams } from 'expo-router';

import { PassengerToaster } from '@/features/booking/presentation/PassengerToaster';
import { useNegotiationSocket } from '@/features/rides/application/useNegotiationSocket';
import { usePassengerActiveRide } from '@/features/rides/application/useRides';

/**
 * Stack del área autenticada; contiene el navegador de tabs (Viaje/Historial/…).
 * El `PassengerToaster` flota sobre cualquier pantalla para avisar en vivo de los
 * desenlaces de las ofertas (nueva, expirada, retirada).
 */
export default function AppLayout() {
  const { ride } = usePassengerActiveRide();
  const { rideId: routeRideIdParam } = useGlobalSearchParams<{
    rideId?: string | string[];
  }>();
  const routeRideId = Array.isArray(routeRideIdParam)
    ? routeRideIdParam[0]
    : routeRideIdParam;
  // Tras crear una solicitud, `/me/active` y la navegacion convergen en paralelo.
  // El parametro de la pantalla mantiene el canal vivo durante esa ventana y al
  // volver de background, incluso si React Query conserva temporalmente `null`.
  const socketRideId = ride?.id ?? routeRideId ?? null;
  const socketEnabled =
    socketRideId != null &&
    (ride == null || (ride.status !== 'completed' && ride.status !== 'cancelled'));

  // Una sola conexión sobrevive a los cambios Offers -> Configure -> Trip.
  useNegotiationSocket(socketRideId, socketEnabled);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="booking/offers" options={{ gestureEnabled: false }} />
        <Stack.Screen name="booking/trip" options={{ gestureEnabled: false }} />
        <Stack.Screen name="booking/rating" options={{ gestureEnabled: false }} />
      </Stack>
      <PassengerToaster />
    </>
  );
}
