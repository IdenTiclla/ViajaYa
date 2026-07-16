/**
 * Marcador de ruta reutilizable: pin circular con letra (A = origen, B = destino)
 * y un tooltip "Origen"/"Destino" arriba. Lo usan todas las vistas que muestran un
 * trayecto (pasajero y conductor) para que origen y destino se vean siempre igual.
 *
 * El tooltip va en flujo (no absoluto) para que renderice de forma fiable dentro
 * del marker en iOS y Android; el `anchor` apunta al pin (no al centro del
 * conjunto) para que el punto quede exacto en la coordenada.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { colors, fontWeight, radius, spacing } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';

type Props = {
  kind: 'A' | 'B';
  coordinate: Coordinates;
  /** Texto del tooltip (p. ej. "Origen", "Destino"). */
  label: string;
  /** Oculta el tooltip cuando la información se presenta fuera del mapa. */
  showTooltip?: boolean;
  /** Reduce ligeramente la tipografía para compensar el escalado del marcador nativo. */
  compactTooltip?: boolean;
  /** Muestra un control de edición unido al marcador. */
  showEditControl?: boolean;
  /** Atenuar el pin (p. ej. orígenes no seleccionados en el mapa de solicitudes). */
  dim?: boolean;
  /** Jerarquía del marcador cuando varios puntos se superponen. */
  zIndex?: number;
  onPress?: () => void;
};

// Compacto para no tapar la ruta ni otros puntos cercanos en el mapa.
const PIN_SIZE = 18;

export function RoutePinMarker({
  kind,
  coordinate,
  label,
  showTooltip = true,
  compactTooltip,
  showEditControl,
  dim,
  zIndex,
  onPress,
}: Props) {
  return (
    <Marker
      coordinate={coordinate}
      // En Google Maps Android las polilíneas y los marcadores son capas
      // separadas; un z-index explícito mantiene el pin visible sobre la ruta.
      zIndex={zIndex ?? 10}
      anchor={{ x: 0.5, y: showEditControl ? 0.87 : showTooltip ? 0.72 : 0.5 }}
      onPress={onPress}>
      <View style={styles.wrap}>
        {showEditControl && (
          <View
            style={[
              styles.editControl,
              kind === 'A' ? styles.editOrigin : styles.editDestination,
            ]}>
            <Ionicons name="create" size={11} color={colors.textOnPrimary} />
            <Text style={styles.editText}>Editar</Text>
          </View>
        )}
        {showTooltip && (
          <View style={styles.tooltip}>
            <Text style={[styles.tooltipText, compactTooltip && styles.tooltipTextCompact]}>
              {label}
            </Text>
          </View>
        )}
        <View
          style={[styles.pinBase, kind === 'A' ? styles.pinA : styles.pinB, dim && styles.pinDim]}>
          <Text style={styles.pinLabel}>{kind}</Text>
        </View>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  editControl: {
    width: 56,
    height: 22,
    marginBottom: spacing.xs,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 2,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  editOrigin: { backgroundColor: colors.primary },
  editDestination: { backgroundColor: colors.danger },
  editText: { color: colors.textOnPrimary, fontSize: 9, fontWeight: fontWeight.bold },
  tooltip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  tooltipText: {
    maxWidth: 160,
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  tooltipTextCompact: { fontSize: 9 },
  pinBase: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pinA: { backgroundColor: colors.primary },
  pinB: { backgroundColor: colors.danger },
  pinDim: { opacity: 0.5 },
  pinLabel: { color: colors.textOnPrimary, fontSize: 10, fontWeight: fontWeight.bold },
});
