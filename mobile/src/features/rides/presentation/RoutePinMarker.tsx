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
  /** Atenuar el pin (p. ej. orígenes no seleccionados en el mapa de solicitudes). */
  dim?: boolean;
  /** Muestra un lápiz sobre el tooltip; al tocar el marcador se invoca `onPress`. */
  showEditControl?: boolean;
  onPress?: () => void;
};

// Compacto para no tapar la ruta ni otros puntos cercanos en el mapa.
const PIN_SIZE = 20;

export function RoutePinMarker({
  kind,
  coordinate,
  label,
  dim,
  showEditControl,
  onPress,
}: Props) {
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: showEditControl ? 0.87 : 0.72 }}
      onPress={onPress}>
      <View style={styles.wrap}>
        {showEditControl && (
          <View
            style={[
              styles.editControl,
              kind === 'A' ? styles.editOrigin : styles.editDestination,
            ]}>
            <Ionicons name="create" size={14} color={colors.textOnPrimary} />
          </View>
        )}
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>{label}</Text>
        </View>
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
    width: 28,
    height: 28,
    marginBottom: spacing.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
