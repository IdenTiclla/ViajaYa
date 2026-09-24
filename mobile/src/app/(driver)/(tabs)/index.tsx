import { Redirect } from 'expo-router';

/**
 * Fallback for the driver's base segment: redirects to Solicitudes (the real
 * initial screen). The root redirect in app/index.tsx already points there; this covers
 * manual navigation to "/(driver)/(tabs)" without a sub-segment.
 */
export default function DriverTabIndex() {
  return <Redirect href="/(driver)/(tabs)/solicitudes" />;
}
