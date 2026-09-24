import { useDriverLocationSharing } from '@/features/tracking/application/useDriverLocationSharing';
import { Stack } from 'expo-router';

import { DriverToaster } from '@/features/driver/presentation/DriverToaster';
import { useDriverPoolSocket } from '@/features/rides/application/useNegotiationSocket';

/** Stack of the driver's authenticated area; it holds their tab navigator. */
export default function DriverLayout() {
  // Single live channel for the WHOLE driver area: new requests,
  // passenger acceptances (to confirm), race results and changes
  // to the assigned ride. This way notices arrive on whichever screen they are.
  useDriverPoolSocket();
  useDriverLocationSharing();
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <DriverToaster />
    </>
  );
}
