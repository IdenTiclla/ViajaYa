import { StyleSheet, Text } from 'react-native';
import { fontSize, spacing, useEstilos, type Tema } from '@/core/theme';
import type { ServiceType } from '@/features/booking/domain/types';

export function MotorcycleRouteNotice({ service }: { service: ServiceType }) {
  const { styles } = useEstilos(createStyles);
  if (service !== 'moto') return null;
  return <Text style={styles.notice}>Ruta de moto en pruebas: puede omitir vías aptas. Respeta la señalización.</Text>;
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  notice: { padding: spacing.sm, backgroundColor: colors.surface, color: colors.textSecondary, fontSize: fontSize.sm },
});
