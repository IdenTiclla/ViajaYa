import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useEstilos, type Tema } from '@/core/theme';
import { ProveedorTema } from '@/core/theme/ProveedorTema';
import { SessionRecoveryScreen } from '@/features/auth/presentation/SessionRecoveryScreen';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { usePassengerToasts } from '@/features/booking/application/usePassengerToasts';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { useDriverToasts } from '@/features/driver/application/useDriverToasts';
import { useAuthStore } from '@/store/authStore';

// Singleton a nivel de módulo: una sola instancia para toda la app.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RootNavigator() {
  const { colors, styles } = useEstilos(crearEstilos);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const identity = user?.id ?? null;
  const [readyIdentity, setReadyIdentity] = useState<string | null | undefined>(undefined);

  // Restaura la sesión desde SecureStore al arrancar.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // No monta ninguna pantalla de la nueva sesión hasta haber limpiado todo el
  // estado en memoria de la identidad anterior.
  useEffect(() => {
    if (status === 'loading' || readyIdentity === identity) return;
    queryClient.clear();
    useBookingStore.getState().resetAll();
    useDriverRequests.getState().reset();
    useDriverToasts.getState().clear();
    usePassengerToasts.getState().clear();
    const readyTimer = setTimeout(() => setReadyIdentity(identity), 0);
    return () => clearTimeout(readyTimer);
  }, [identity, readyIdentity, status]);

  if (status === 'error') return <SessionRecoveryScreen />;

  if (status === 'loading' || readyIdentity !== identity) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isAuthenticated = status === 'authenticated';
  const isDriver = isAuthenticated && user?.role === 'driver';

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated && !isDriver}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={isDriver}>
        <Stack.Screen name="(driver)" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

function ContenidoRaiz() {
  const { styles } = useEstilos(crearEstilos);
  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <RootNavigator />
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return <ProveedorTema><ContenidoRaiz /></ProveedorTema>;
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  root: { flex: 1 },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
