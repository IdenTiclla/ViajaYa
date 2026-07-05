import { Redirect } from 'expo-router';

import { useAuthStore } from '@/store/authStore';

/** Punto de entrada "/": redirige según el estado de sesión y el rol del usuario. */
export default function Index() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === 'loading') return null;
  if (status !== 'authenticated') return <Redirect href="/(auth)/login" />;
  // El conductor entra viendo las solicitudes/ofertas entrantes; el pasajero, su viaje.
  return (
    <Redirect
      href={user?.role === 'driver' ? '/(driver)/(tabs)/solicitudes' : '/(app)/(tabs)'}
    />
  );
}
