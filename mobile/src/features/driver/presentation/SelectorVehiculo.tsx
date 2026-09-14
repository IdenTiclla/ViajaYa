/** One button per approved vehicle: "Conducir con Taxi · 1234-ABC". */
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';
import { VEHICLE_META } from '@/features/auth/domain/vehicleCatalog';
import type { DriverVehicle } from '@/features/driver/domain/types';
import { Button } from '@/shared/components';

type Props = {
  vehicles: DriverVehicle[];
  onPick: (vehicleType: VehicleType) => void;
  /** Vehicle currently being submitted (shows its spinner). */
  pending?: VehicleType | null;
  disabled?: boolean;
  /** Highlight this one as the primary action (e.g. the active vehicle). */
  primary?: VehicleType | null;
  titlePrefix?: string;
};

export function SelectorVehiculo({
  vehicles,
  onPick,
  pending = null,
  disabled = false,
  primary = null,
  titlePrefix = 'Conducir con',
}: Props) {
  return (
    <View style={styles.list}>
      {vehicles.map((vehicle) => (
        <Button
          key={vehicle.vehicleType}
          title={`${titlePrefix} ${VEHICLE_META[vehicle.vehicleType].label} · ${vehicle.plate}`}
          leadingIcon={VEHICLE_META[vehicle.vehicleType].icon}
          variant={primary === vehicle.vehicleType || primary === null ? 'primary' : 'secondary'}
          loading={pending === vehicle.vehicleType}
          disabled={disabled}
          onPress={() => onPick(vehicle.vehicleType)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
