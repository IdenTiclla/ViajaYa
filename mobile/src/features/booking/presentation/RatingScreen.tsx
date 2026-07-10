/**
 * Calificación del viaje (pasajero) — pantalla "Viaje Finalizado".
 *
 * Carga el viaje por `rideId`, muestra el resumen y permite calificar al
 * conductor. Al finalizar, vuelve al inicio.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, spacing } from '@/core/theme';
import {
  PASSENGER_ACTIVE_RIDE_KEY,
  PENDING_RATING_RIDE_KEY,
  useRide,
} from '@/features/rides/application/useRides';
import type { Ride } from '@/features/rides/domain/types';
import { RideRatingCard } from '@/features/rides/presentation/RideRatingCard';
import { Button } from '@/shared/components';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

export function RatingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;
  const { ride, isLoading, isError, error, refetch } = useRide(id);

  const goHome = () => {
    if (id) {
      queryClient.setQueryData<Ride | null>(PASSENGER_ACTIVE_RIDE_KEY, (current) =>
        current?.id === id ? null : current,
      );
      queryClient.setQueryData<Ride | null>(PENDING_RATING_RIDE_KEY, (current) =>
        current?.id === id ? null : current,
      );
    }
    router.replace('/(app)/(tabs)');
  };

  if (!id) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.errorTitle}>El viaje solicitado no es válido</Text>
        <View style={styles.action}>
          <Button title="Volver al inicio" onPress={goHome} />
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading && !ride) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.errorTitle}>No pudimos cargar el cierre del viaje</Text>
        {isError && <Text style={styles.errorHint}>{getApiErrorMessage(error)}</Text>}
        <View style={styles.action}>
          <Button title="Reintentar" onPress={() => void refetch()} />
        </View>
      </SafeAreaView>
    );
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
  errorTitle: { color: colors.text, fontSize: fontSize.md, textAlign: 'center' },
  errorHint: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
  action: { width: '100%', maxWidth: 280, marginTop: spacing.sm },
});
