import { Stack } from 'expo-router';

import { DriverToaster } from '@/features/driver/presentation/DriverToaster';
import { useDriverPoolSocket } from '@/features/rides/application/useNegotiationSocket';

/** Stack del área autenticada del conductor; contiene su navegador de tabs. */
export default function DriverLayout() {
  // Canal en vivo único para TODA el área del conductor: solicitudes nuevas,
  // aceptaciones del pasajero (a confirmar), resultado de la carrera y cambios
  // del viaje asignado. Así los avisos llegan esté en la pantalla que esté.
  useDriverPoolSocket();
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <DriverToaster />
    </>
  );
}
