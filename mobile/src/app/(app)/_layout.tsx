import { Stack, useGlobalSearchParams } from 'expo-router';

import { PassengerToaster } from '@/features/booking/presentation/PassengerToaster';
import { useNegotiationSocket } from '@/features/rides/application/useNegotiationSocket';
import { usePassengerActiveRide } from '@/features/rides/application/useRides';

/**
 * Stack of the authenticated area; it holds the tab navigator (Viaje/Historial/…).
 * `PassengerToaster` floats over any screen to report offer outcomes
 * live (new, expired, withdrawn).
 */
export default function AppLayout() {
  const { ride } = usePassengerActiveRide();
  const { rideId: routeRideIdParam } = useGlobalSearchParams<{
    rideId?: string | string[];
  }>();
  const routeRideId = Array.isArray(routeRideIdParam)
    ? routeRideIdParam[0]
    : routeRideIdParam;
  // After creating a request, `/me/active` and navigation converge in parallel.
  // The screen parameter keeps the channel alive during that window and when
  // coming back from background, even if React Query temporarily keeps `null`.
  const socketRideId = ride?.id ?? routeRideId ?? null;
  const socketEnabled =
    socketRideId != null &&
    (ride == null || (ride.status !== 'completed' && ride.status !== 'cancelled'));

  // A single connection survives the Offers -> Configure -> Trip transitions.
  useNegotiationSocket(socketRideId, socketEnabled);

  return (
    <>
      <Stack initialRouteName="(tabs)" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="booking/offers" options={{ gestureEnabled: false }} />
        <Stack.Screen name="booking/trip" options={{ gestureEnabled: false }} />
        <Stack.Screen name="booking/rating" options={{ gestureEnabled: false }} />
      </Stack>
      <PassengerToaster />
    </>
  );
}
