import { Text, View, StyleSheet } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/shared/components';
import { fontSize, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useLocationSharingStore } from '../application/locationSharingStore';
import { startSharing } from '../application/driverLocationTask';

export function DriverSharingStatus({ rideId }: { rideId: string }) {
  const { styles } = useThemedStyles(createStyles);
  const sharing = useLocationSharingStore();
  const userId = useAuthStore(s => s.user?.id);
  const failed = sharing.rideId === rideId && sharing.status === 'error';
  return <View style={styles.group}>
    <Text style={[styles.text, failed && styles.error]} accessibilityLiveRegion="polite">
      {failed ? sharing.error : sharing.rideId === rideId && sharing.status === 'sharing'
        ? 'Tu pasajero puede ver tu ubicación en vivo.' : 'Preparando tu ubicación para el pasajero…'}
    </Text>
    {failed && <Button title="Reintentar ubicación" variant="text" onPress={() => { if (userId) void startSharing({ rideId, userId }); }} />}
  </View>;
}
const createStyles = ({ colors }: Theme) => StyleSheet.create({
  group: { gap: spacing.xs }, text: { color: colors.textSecondary, fontSize: fontSize.sm }, error: { color: colors.danger },
});
