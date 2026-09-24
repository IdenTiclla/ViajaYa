import { Redirect } from 'expo-router';

import { useAuthStore } from '@/store/authStore';

/** Entry point "/": redirects based on the session state and the user's role. */
export default function Index() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const modeChoicePending = useAuthStore((s) => s.modeChoicePending);

  if (status === 'loading') return null;
  if (status !== 'authenticated') return <Redirect href="/(auth)" />;
  // An approved driver who just signed in picks passenger or driver (and vehicle) first.
  if (modeChoicePending) return <Redirect href="/elegir-modo" />;
  // The driver lands on the incoming requests/offers; the passenger, on their ride.
  return (
    <Redirect
      href={user?.role === 'driver' ? '/(driver)/(tabs)/solicitudes' : '/(app)/(tabs)'}
    />
  );
}
