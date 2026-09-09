/**
 * Pin fijo en el centro del mapa: el usuario mueve el mapa por debajo y el pin
 * marca siempre el centro geográfico (que coincide con el centro de la cámara).
 * No captura toques (`pointerEvents="none"`) para no interferir con el gesto del
 * mapa. El extremo del tallo se ancla al 50% del mapa, independientemente de la
 * altura de la etiqueta o del tamaño de texto elegido en el teléfono.
 */
import { StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { PinLoadingIndicator } from '@/shared/components/PinLoadingIndicator';
import { InsigniaPuntoMapa, type TipoPuntoMapa } from '@/shared/components/mapa/InsigniaPuntoMapa';

export function CenterPin({
  label,
  tipo = 'origen',
  loading = false,
}: {
  label: string;
  tipo?: TipoPuntoMapa;
  loading?: boolean;
}) {
  const { colors, styles } = useEstilos(crearEstilos);
  const color = tipo === 'destino' ? colors.danger : colors.primary;
  const nombre = tipo === 'origen' ? 'Origen' : tipo === 'destino' ? 'Destino' : 'Lugar';
  return (
    <View
      style={styles.overlay}
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${nombre}. ${label}`}
      accessibilityState={{ busy: loading }}>
      <View style={styles.callout}>
        <PinLoadingIndicator loading={loading} color={colors.surface} compact />
        <Text style={styles.calloutText} numberOfLines={2} ellipsizeMode="tail">
          {label}
        </Text>
      </View>
      <InsigniaPuntoMapa tipo={tipo} tamano={32} borde={2} tamanoLetra={17} />
      <View style={[styles.tallo, { backgroundColor: color }]}>
        <View style={[styles.puntoExacto, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '50%',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  tallo: { width: 2, height: 14, alignItems: 'center' },
  puntoExacto: {
    position: 'absolute', bottom: -4, width: 8, height: 8,
    borderRadius: 4, borderWidth: 1.5, borderColor: colors.surface,
  },
  callout: {
    maxWidth: '100%',
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
    color: colors.surface,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
