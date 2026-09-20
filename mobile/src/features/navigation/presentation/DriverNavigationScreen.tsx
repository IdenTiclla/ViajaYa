import type { ComponentType } from 'react';
import { Platform, TurboModuleRegistry, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, FeedbackState } from '@/shared/components';
import { useDriverActiveRide } from '@/features/rides/application/useRides';
import type { Ride } from '@/features/rides/domain/types';
import { spacing } from '@/core/theme';
import { navigationTarget } from '../domain/navigationTarget';
import { DriverNavigationActions } from './DriverNavigationActions';

// Older development APKs must remain usable until the new native build is installed.
const NativeScreen: ComponentType<{ ride: Ride }> | null = Platform.OS === 'android' && TurboModuleRegistry.get('NavModule')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Avoid loading absent modules in older APKs.
  ? require('./NativeDriverNavigation').NativeDriverNavigation : null;

export function DriverNavigationScreen() {
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const { ride, isLoading, refetch } = useDriverActiveRide();
  const router = useRouter();
  const valid = ride?.id === rideId && navigationTarget(ride);
  if (valid && ride && NativeScreen) return <NativeScreen ride={ride} />;
  return <SafeAreaView style={{ flex: 1, padding: spacing.md }}>
    <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
      <FeedbackState loading={isLoading} icon="navigate-outline"
        title={valid ? 'Navegación integrada pendiente de instalar' : 'Este viaje ya no está activo'}
        message={valid ? 'Instala la nueva versión de ViajaYa para recibir indicaciones dentro de la app. Mientras tanto puedes abrir Waze.' : 'Vuelve al viaje para revisar su estado.'}
        actionLabel={!valid && !isLoading ? 'Actualizar viaje' : undefined}
        onAction={() => void refetch()} />
      {valid && ride && <DriverNavigationActions ride={ride} nativeAvailable={false} />}
      <Button title="Volver al viaje" onPress={() => router.back()} />
    </View>
  </SafeAreaView>;
}
