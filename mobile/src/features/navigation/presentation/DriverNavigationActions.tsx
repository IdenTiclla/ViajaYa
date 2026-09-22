import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, useEstilos, type Tema } from '@/core/theme';
import { Button } from '@/shared/components';
import type { Ride } from '@/features/rides/domain/types';
import { canShareWhileAway } from '@/features/tracking/application/driverLocationTask';
import { useWazeNavigation } from '../application/useWazeNavigation';
import { navigationTarget } from '../domain/navigationTarget';

export function DriverNavigationActions({ ride, nativeAvailable = true }: { ride: Ride; nativeAvailable?: boolean }) {
  const { styles } = useEstilos(createStyles);
  const router = useRouter();
  const target = navigationTarget(ride);
  const waze = useWazeNavigation(target);
  if (!target) return null;
  return <View style={styles.group}>
    <View style={styles.row}>
      {nativeAvailable && <Button title={target.label} leadingIcon="navigate-outline" variant="secondary" style={styles.button}
        onPress={() => router.push({ pathname: '/(driver)/navigation', params: { rideId: ride.id } })} />}
      <Button title="Waze" leadingIcon="open-outline" variant="secondary" loading={waze.opening} onPress={waze.open} />
    </View>
    {!canShareWhileAway && <Text style={styles.hint}>Esta versión comparte tu ubicación solo mientras ViajaYa está abierta. Actualiza la app para mantenerla al usar Waze.</Text>}
    {target.motorcycle && <Text style={styles.hint}>En Waze, selecciona motocicleta en el tipo de vehículo.</Text>}
    {waze.error && <Text style={styles.error} accessibilityRole="alert">{waze.error}</Text>}
  </View>;
}
const createStyles = ({ colors }: Tema) => StyleSheet.create({
  group: { gap: spacing.xs }, row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  button: { flexGrow: 1 }, hint: { color: colors.textSecondary, fontSize: 12 }, error: { color: colors.danger },
});
