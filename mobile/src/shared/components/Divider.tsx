import { StyleSheet, Text, View } from 'react-native';

import { fontSize, spacing, useEstilos, type Tema } from '@/core/theme';

type Props = { label?: string };

/** Separador horizontal; con `label` muestra el típico "O CONTINÚA CON". */
export function Divider({ label }: Props) {
  const { styles } = useEstilos(crearEstilos);
  if (!label) return <View style={styles.line} />;
  return (
    <View style={styles.row}>
      <View style={styles.flexLine} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.flexLine} />
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  line: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flexLine: { flex: 1, height: 1, backgroundColor: colors.border },
  label: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
