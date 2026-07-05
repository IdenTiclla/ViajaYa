import { Redirect } from 'expo-router';

/**
 * Fallback del segmento base del conductor: redirige a Solicitudes (la pantalla
 * inicial real). El redirect raíz en app/index.tsx ya apunta ahí; esto cubre la
 * navegación manual a "/(driver)/(tabs)" sin sub-segmento.
 */
export default function DriverTabIndex() {
  return <Redirect href="/(driver)/(tabs)/solicitudes" />;
}
