import { Stack } from 'expo-router';

/** Stack del área autenticada; contiene el navegador de tabs (Viaje/Historial/…). */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
