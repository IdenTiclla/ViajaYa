/**
 * Pin fijo en el centro del mapa: el usuario mueve el mapa por debajo y el pin
 * marca siempre el centro geográfico (que coincide con el centro de la cámara).
 * No captura toques (`pointerEvents="none"`) para no interferir con el gesto del
 * mapa. La punta del pin queda alineada con el centro de la pantalla gracias al
 * `marginBottom` igual a la altura del bloque (truco estándar de centrado).
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { PinLoadingIndicator } from '@/shared/components';

const PIN_SIZE = 46;

export function CenterPin({
  label,
  color = colors.primary,
  loading = false,
}: {
  label: string;
  color?: string;
  loading?: boolean;
}) {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.block}>
        <View style={styles.callout}>
          <PinLoadingIndicator loading={loading} color={colors.textOnPrimary} compact />
          <Text style={styles.calloutText} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
        </View>
        <Ionicons name="location" size={PIN_SIZE} color={color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // marginBottom ≈ altura del bloque para que la punta del pin caiga en el centro.
  block: { alignItems: 'center', marginBottom: PIN_SIZE + 28 },
  callout: {
    maxWidth: 300,
    backgroundColor: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  calloutText: {
    flexShrink: 1,
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
