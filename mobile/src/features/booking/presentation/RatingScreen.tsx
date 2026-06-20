/**
 * Calificación del viaje (pasajero) — pantalla "Viaje Finalizado".
 *
 * Carga el viaje por `rideId`, muestra el resumen y permite calificar al
 * conductor. Al finalizar, vuelve al inicio.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/core/theme';
import { useRide } from '@/features/rides/application/useRides';
import { RideRatingCard } from '@/features/rides/presentation/RideRatingCard';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

export function RatingScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;
  const { ride, isLoading } = useRide(id);

  const goHome = () => router.replace('/(app)/(tabs)');

  if (isLoading && !ride) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!ride) {
    return <SafeAreaView style={[styles.root, styles.center]} />;
  }

  const vehicle = ride.driver
    ? [
        ride.driver.vehicleType ? SERVICE_LABELS[ride.driver.vehicleType] : null,
        ride.driver.vehicleModel,
        ride.driver.plate,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <RideRatingCard
          ride={ride}
          rateeRole="driver"
          counterpartName={ride.driver?.fullName ?? null}
          counterpartVehicle={vehicle}
          onDone={goHome}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
});
