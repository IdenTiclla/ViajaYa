/**
 * Passenger profile block: the vehicles registered to drive with (up to one per
 * type), their review status, adding/editing/removing them and, once one is
 * approved, entering driver mode with the chosen vehicle.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { DriverStatus, VehicleType } from '@/features/auth/domain/types';
import { VEHICLE_META } from '@/features/auth/domain/vehicleCatalog';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import {
  approvedVehicles,
  useDriverVehicles,
  useRemoveDriverVehicle,
  useSwitchAccountMode,
} from '@/features/driver/application/useDriverAccount';
import { MAX_DRIVER_VEHICLES, type DriverVehicle } from '@/features/driver/domain/types';
import { VehicleSelector } from '@/features/driver/presentation/VehicleSelector';
import { Button, ConfirmDialog } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

const STATUS_META: Record<DriverStatus, { label: string; icon: IoniconsIconName }> = {
  pending: { label: 'En revisión', icon: 'time-outline' },
  approved: { label: 'Aprobado', icon: 'checkmark-circle-outline' },
  rejected: { label: 'No aprobado', icon: 'alert-circle-outline' },
};

export function DriverAccountCard() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const vehicles = useDriverVehicles(user != null);
  const switchMode = useSwitchAccountMode();
  const remove = useRemoveDriverVehicle();
  const [pendingVehicle, setPendingVehicle] = useState<VehicleType | null>(null);
  const [toRemove, setToRemove] = useState<DriverVehicle | null>(null);
  if (!user) return null;

  const list = vehicles.data ?? [];
  const approved = approvedVehicles(list);
  const canAdd = list.length < MAX_DRIVER_VEHICLES;
  const goToForm = (vehicleType?: VehicleType) =>
    router.navigate({
      pathname: '/(app)/conductor/registro',
      params: vehicleType ? { vehicle: vehicleType } : {},
    });
  const enterAsDriver = (vehicleType: VehicleType) => {
    setPendingVehicle(vehicleType);
    switchMode.mutate({ mode: 'driver', vehicleType });
  };
  const busy = switchMode.isPending || remove.isPending;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons accessible={false} name="car-sport-outline" size={22} color={colors.primary} />
        <Text style={styles.title}>
          {list.length === 0 ? 'Conviértete en conductor' : 'Tus vehículos'}
        </Text>
      </View>

      {vehicles.isPending ? (
        <ActivityIndicator color={colors.primary} />
      ) : vehicles.isError ? (
        <>
          <Text style={styles.error} accessibilityRole="alert">
            {getApiErrorMessage(vehicles.error)}
          </Text>
          <Button title="Reintentar" variant="secondary" onPress={() => vehicles.refetch()} />
        </>
      ) : list.length === 0 ? (
        <Text style={styles.text}>
          Registra tu taxi, moto o camioneta y ofrece viajes, encomiendas o mudanzas. Puedes
          tener hasta un vehículo de cada tipo.
        </Text>
      ) : (
        <View style={styles.vehicles} accessibilityRole="list">
          {list.map((vehicle) => (
            <VehicleRow
              key={vehicle.vehicleType}
              vehicle={vehicle}
              disabled={busy}
              onEdit={() => goToForm(vehicle.vehicleType)}
              onRemove={() => setToRemove(vehicle)}
            />
          ))}
        </View>
      )}

      {(switchMode.isError || remove.isError) && (
        <Text style={styles.error} accessibilityRole="alert">
          {getApiErrorMessage(switchMode.error ?? remove.error)}
        </Text>
      )}

      <View style={styles.actions}>
        {approved.length > 0 && (
          <VehicleSelector
            vehicles={approved}
            onPick={enterAsDriver}
            pending={switchMode.isPending ? pendingVehicle : null}
            disabled={busy}
            primary={user.vehicleType ?? null}
            titlePrefix={approved.length > 1 ? 'Conducir con' : 'Modo conductor ·'}
          />
        )}
        {canAdd && !vehicles.isPending && (
          <Button
            title={list.length === 0 ? 'Registrarme como conductor' : 'Agregar otro vehículo'}
            leadingIcon={list.length === 0 ? undefined : 'add'}
            variant="secondary"
            disabled={busy}
            onPress={() => goToForm()}
          />
        )}
      </View>

      <ConfirmDialog
        visible={toRemove != null}
        icon="trash-outline"
        destructive
        title={toRemove ? `¿Quitar ${VEHICLE_META[toRemove.vehicleType].label.toLowerCase()}?` : ''}
        message={
          toRemove
            ? `${VEHICLE_META[toRemove.vehicleType].label} · ${toRemove.plate}. Podrás registrarlo de nuevo cuando quieras.`
            : ''
        }
        confirmText="Sí, quitar"
        cancelText="Conservar"
        onConfirm={() => {
          if (toRemove) remove.mutate(toRemove.vehicleType);
          setToRemove(null);
        }}
        onCancel={() => setToRemove(null)}
      />
    </View>
  );
}

function VehicleRow({
  vehicle,
  disabled,
  onEdit,
  onRemove,
}: {
  vehicle: DriverVehicle;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const meta = VEHICLE_META[vehicle.vehicleType];
  const status = STATUS_META[vehicle.status];
  const services = vehicle.services.map((s) => SERVICE_META[s].shortLabel).join(' · ');
  return (
    <View style={styles.row}>
      <Ionicons accessible={false} name={meta.icon} size={22} color={colors.primary} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>
          {meta.label} · {vehicle.plate}
        </Text>
        <Text style={styles.rowMeta}>{[vehicle.vehicleModel, services].join(' — ')}</Text>
        <View style={styles.status}>
          <Ionicons
            accessible={false}
            name={status.icon}
            size={14}
            color={vehicle.status === 'approved' ? colors.success : colors.textSecondary}
          />
          <Text style={styles.statusText}>{status.label}</Text>
        </View>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Editar ${meta.label}`}
          disabled={disabled}
          hitSlop={8}
          onPress={onEdit}
          style={styles.iconButton}>
          <Ionicons name="create-outline" size={20} color={colors.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Quitar ${meta.label}`}
          disabled={disabled}
          hitSlop={8}
          onPress={onRemove}
          style={styles.iconButton}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  text: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  error: { fontSize: fontSize.sm, color: colors.danger },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  vehicles: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  rowMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { fontSize: fontSize.xs, color: colors.textSecondary },
  rowActions: { flexDirection: 'row', gap: spacing.xs },
  iconButton: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
});
