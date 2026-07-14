/**
 * Resumen de ruta (origen → destino) que se muestra ARRIBA en las pantallas de
 * viaje, separado del bottom sheet. Pin **A** (origen, "Punto de partida") y pin
 * **B** (destino), con sus nombres; opcionalmente botones "Editar" (p. ej. para
 * que el pasajero ajuste origen/destino al configurar el viaje).
 *
 * Es translúcido (glass) para verse bien sobre el mapa.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { getPlaceStreetName } from '@/features/booking/domain/placeLabels';
type PlaceLite = { name: string; address?: string };

type Props = {
  origin: PlaceLite;
  destination: PlaceLite;
  onEditOrigin?: () => void;
  onEditDestination?: () => void;
};

export function RouteSummary({ origin, destination, onEditOrigin, onEditDestination }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.track}>
        <View style={styles.dotA}>
          <Text style={styles.dotText}>A</Text>
        </View>
        <View style={styles.line} />
        <View style={styles.dotB}>
          <Text style={styles.dotText}>B</Text>
        </View>
      </View>
      <View style={styles.texts}>
        <View style={styles.row}>
          <View style={styles.rowHeader}>
            <Text style={styles.label}>Punto de partida</Text>
            {onEditOrigin && (
              <TouchableOpacity
                onPress={onEditOrigin}
                accessibilityRole="button"
                accessibilityLabel="Editar punto de partida">
                <Text style={styles.edit}>Editar</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.value} numberOfLines={1}>
            {getPlaceStreetName(origin)}
          </Text>
        </View>
        <View style={styles.row}>
          <View style={styles.rowHeader}>
            <Text style={styles.label}>Punto de destino</Text>
            {onEditDestination && (
              <TouchableOpacity
                onPress={onEditDestination}
                accessibilityRole="button"
                accessibilityLabel="Editar destino">
                <Text style={styles.edit}>Editar</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.value} numberOfLines={1}>
            {getPlaceStreetName(destination)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  track: { alignItems: 'center', paddingTop: 2 },
  dotA: {
    width: 18,
    height: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  dotB: {
    width: 18,
    height: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  dotText: { color: colors.textOnPrimary, fontSize: 10, fontWeight: fontWeight.bold },
  line: { width: 2, minHeight: 12, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  texts: { flex: 1, gap: spacing.sm },
  row: { gap: 1 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.medium },
  value: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  edit: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary },
});
