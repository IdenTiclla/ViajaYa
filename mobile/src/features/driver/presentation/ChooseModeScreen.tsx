/**
 * Shown right after signing in with an approved driver account: enter as a
 * passenger or as a driver, choosing the vehicle when there is more than one.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';
import {
  approvedVehicles,
  useDriverVehicles,
  useSwitchAccountMode,
} from '@/features/driver/application/useDriverAccount';
import { VehicleSelector } from '@/features/driver/presentation/VehicleSelector';
import { Button } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

export function ChooseModeScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const user = useAuthStore((s) => s.user);
  const vehicles = useDriverVehicles();
  const switchMode = useSwitchAccountMode();
  const [pendingVehicle, setPendingVehicle] = useState<VehicleType | null>(null);
  const approved = approvedVehicles(vehicles.data);
  const firstName = user?.fullName.trim().split(/\s+/)[0] ?? '';

  const enterAsDriver = (vehicleType: VehicleType) => {
    setPendingVehicle(vehicleType);
    switchMode.mutate({ mode: 'driver', vehicleType });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Ionicons name="swap-horizontal" size={48} color={colors.primary} />
        <Text style={styles.title}>{firstName ? `Hola, ${firstName}` : 'Hola'}</Text>
        <Text style={styles.subtitle}>¿Cómo quieres entrar hoy?</Text>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Como pasajero</Text>
          <Button
            title="Pedir viajes"
            leadingIcon="person-outline"
            variant="secondary"
            loading={switchMode.isPending && pendingVehicle === null}
            disabled={switchMode.isPending}
            onPress={() => {
              setPendingVehicle(null);
              switchMode.mutate({ mode: 'passenger' });
            }}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Como conductor</Text>
          {vehicles.isPending ? (
            <ActivityIndicator color={colors.primary} />
          ) : vehicles.isError ? (
            <>
              <Text style={styles.error} accessibilityRole="alert">
                {getApiErrorMessage(vehicles.error)}
              </Text>
              <Button title="Reintentar" variant="secondary" onPress={() => vehicles.refetch()} />
            </>
          ) : approved.length === 0 ? (
            <Text style={styles.hint}>Aún no tienes un vehículo aprobado.</Text>
          ) : (
            <VehicleSelector
              vehicles={approved}
              onPick={enterAsDriver}
              pending={switchMode.isPending ? pendingVehicle : null}
              disabled={switchMode.isPending}
              primary={user?.vehicleType ?? null}
            />
          )}
        </View>

        {switchMode.isError && (
          <Text style={styles.error} accessibilityRole="alert">
            {getApiErrorMessage(switchMode.error)}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'stretch',
  },
  title: {
    marginTop: spacing.md,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
  section: { marginTop: spacing.lg, gap: spacing.sm },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary },
  error: { fontSize: fontSize.sm, color: colors.danger, textAlign: 'center' },
});
