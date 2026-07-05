import { Stack } from 'expo-router';

import { PassengerToaster } from '@/features/booking/presentation/PassengerToaster';

/**
 * Stack del área autenticada; contiene el navegador de tabs (Viaje/Historial/…).
 * El `PassengerToaster` flota sobre cualquier pantalla para avisar en vivo de los
 * desenlaces de las ofertas (nueva, expirada, retirada).
 */
export default function AppLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <PassengerToaster />
    </>
  );
}
