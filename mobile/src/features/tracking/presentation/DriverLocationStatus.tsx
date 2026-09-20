import { StyleSheet, Text, View } from 'react-native';
import { useEstilos, fontSize, spacing, type Tema } from '@/core/theme';
import { Button } from '@/shared/components';

export function DriverLocationStatus({ freshness, onRetry }: {
  freshness: 'waiting' | 'unavailable' | 'stale' | 'live'; onRetry: () => void;
}) {
  const { styles } = useEstilos(createStyles);
  return <View style={styles.status} accessibilityLiveRegion="polite">
    <Text style={styles.text}>{freshness === 'live' ? 'Ubicación del conductor en vivo'
      : freshness === 'stale' ? 'Última ubicación conocida · esperando señal nueva'
      : freshness === 'unavailable' ? 'La ubicación del conductor dejó de actualizarse'
      : 'Esperando la ubicación del conductor…'}</Text>
    {freshness !== 'live' && <Text style={styles.hint}>El mapa se actualizará cuando recibamos una señal GPS reciente.</Text>}
    {freshness === 'unavailable' && <Button title="Actualizar ubicación" variant="secondary" onPress={onRetry} />}
  </View>;
}
const createStyles = ({ colors }: Tema) => StyleSheet.create({
  status: { padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.surfaceMuted },
  text: { color: colors.text, fontSize: fontSize.sm },
  hint: { color: colors.textSecondary, fontSize: fontSize.xs },
});
