/**
 * Driver profile — account data, vehicle and sign-out.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { Button } from '@/shared/components';
import { getApiErrorMessage } from '@/core/errors/apiError';
import { useAuthStore } from '@/store/authStore';
import { ThemeSelector } from '@/features/profile/presentation/SelectorTema';
import { AccountSecurityPanel } from '@/features/auth/presentation/AccountSecurityPanel';
import type { VehicleType } from '@/features/auth/domain/types';
import { VEHICLE_META } from '@/features/auth/domain/vehicleCatalog';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import {
  approvedVehicles,
  useDriverVehicles,
  useSwitchAccountMode,
} from '@/features/driver/application/useDriverAccount';
import { VehicleSelector } from '@/features/driver/presentation/SelectorVehiculo';

export function DriverProfileScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const switchMode = useSwitchAccountMode();
  const vehicles = useDriverVehicles();
  const [pendingVehicle, setPendingVehicle] = useState<VehicleType | null>(null);
  // Other approved vehicles the driver could switch to (the active one is excluded).
  const otherVehicles = approvedVehicles(vehicles.data).filter(
    (vehicle) => vehicle.vehicleType !== user?.vehicleType,
  );
  const initial = (user?.fullName?.trim().charAt(0) ?? 'C').toUpperCase();
  const services = user?.driverServices.map((s) => SERVICE_META[s].shortLabel).join(' · ');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{user?.fullName ?? 'Conductor'}</Text>
        <Text style={styles.email}>{user?.phoneVerifiedAt ? user.phone : user?.email}</Text>
        {user?.rating != null && (
          <View style={styles.rating}>
            <Ionicons name="star" size={16} color={colors.accent} />
            <Text style={styles.ratingText}>{user.rating.toFixed(1)}</Text>
          </View>
        )}

        <View style={styles.vehicleCard}>
          <Detail
            icon={user?.vehicleType ? VEHICLE_META[user.vehicleType].icon : 'car-sport'}
            label="Vehículo"
            value={user?.vehicleType ? VEHICLE_META[user.vehicleType].label : '—'}
          />
          <Detail icon="construct" label="Modelo" value={user?.vehicleModel ?? '—'} />
          <Detail icon="card" label="Placa" value={user?.plate ?? '—'} />
          <Detail icon="briefcase" label="Servicios" value={services || '—'} />
        </View>

        {otherVehicles.length > 0 && (
          <View style={styles.modeCard}>
            <Text style={styles.modeTitle}>Cambiar de vehículo</Text>
            <Text style={styles.modeText}>
              {user?.isOnline
                ? 'Te desconectaremos y volverás a conectarte con el vehículo elegido.'
                : 'Las solicitudes que verás dependen de los servicios de ese vehículo.'}
            </Text>
            <VehicleSelector
              vehicles={otherVehicles}
              onPick={(vehicleType) => {
                setPendingVehicle(vehicleType);
                switchMode.mutate({ mode: 'driver', vehicleType });
              }}
              pending={switchMode.isPending ? pendingVehicle : null}
              disabled={switchMode.isPending}
              primary={null}
              titlePrefix="Conducir con"
            />
          </View>
        )}

        <View style={styles.modeCard}>
          <Text style={styles.modeTitle}>Modo pasajero</Text>
          <Text style={styles.modeText}>
            {user?.isOnline
              ? 'Te desconectaremos y volverás a pedir viajes como pasajero. Tus vehículos se conservan.'
              : 'Tus vehículos se conservan; vuelves cuando quieras.'}
          </Text>
          {switchMode.isError && (
            <Text style={styles.modeError} accessibilityRole="alert">
              {getApiErrorMessage(switchMode.error)}
            </Text>
          )}
          <Button
            title="Cambiar a modo pasajero"
            variant="secondary"
            loading={switchMode.isPending && pendingVehicle === null}
            disabled={switchMode.isPending}
            onPress={() => {
              setPendingVehicle(null);
              switchMode.mutate({ mode: 'passenger' });
            }}
          />
        </View>

        <ThemeSelector />
        <AccountSecurityPanel />
        <View style={styles.actions}>
          <Button
            title="Historial de viajes"
            variant="secondary"
            onPress={() => router.navigate('/(driver)/(tabs)/historial')}
          />
          <Button title="Cerrar sesión" variant="secondary" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: IoniconsIconName;
  label: string;
  value: string;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const { fontScale } = useWindowDimensions();
  const inColumn = fontScale > 1.3;
  return (
    <View style={[styles.detailRow, inColumn && styles.detailColumn]}>
      {!inColumn && <Ionicons accessible={false} name={icon} size={20} color={colors.primary} />}
      <Text style={[styles.detailLabel, inColumn && styles.detailFullWidth]}>{label}</Text>
      <Text style={[styles.detailValue, inColumn && styles.detailFullWidth]}>{value}</Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, alignItems: 'center', padding: spacing.lg, gap: spacing.xs },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  name: { maxWidth: '100%', fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  email: { maxWidth: '100%', fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  ratingText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },

  vehicleCard: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailColumn: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing.xs },
  detailFullWidth: { flex: 0, width: '100%' },
  detailLabel: { fontSize: fontSize.sm, color: colors.textSecondary, width: 80 },
  detailValue: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },

  modeCard: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  modeTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  modeText: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  modeError: { fontSize: fontSize.sm, color: colors.danger },

  actions: { alignSelf: 'stretch', marginTop: spacing.lg, gap: spacing.sm },
});
