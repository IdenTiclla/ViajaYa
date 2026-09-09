import { StyleSheet, Text, View } from 'react-native';

import { fontWeight, useEstilos, type Tema } from '@/core/theme';
import { PinLoadingIndicator } from '@/shared/components/PinLoadingIndicator';

export type TipoPuntoMapa = 'origen' | 'destino' | 'lugar';

type Props = {
  tipo: TipoPuntoMapa;
  tamano: number;
  borde: number;
  tamanoLetra: number;
  cargando?: boolean;
  atenuado?: boolean;
};

/** Pines circulares compartidos: A para origen y B para destino. */
export function InsigniaPuntoMapa({
  tipo, tamano, borde, tamanoLetra, cargando = false, atenuado = false,
}: Props) {
  const { colors, styles } = useEstilos(crearEstilos);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        {
          width: tamano,
          height: tamano,
          borderWidth: borde,
          borderRadius: tamano / 2,
          backgroundColor: tipo === 'destino' ? colors.danger : colors.primary,
          opacity: atenuado ? 0.5 : 1,
        },
      ]}>
      {/* La letra es parte del símbolo; la etiqueta accesible vive en el marcador. */}
      <Text
        allowFontScaling={false}
        style={[
          styles.letra,
          { fontSize: tamanoLetra, lineHeight: tamano - borde * 2, opacity: cargando ? 0 : 1 },
        ]}>
        {tipo === 'origen' ? 'A' : tipo === 'destino' ? 'B' : '+'}
      </Text>
      <View style={styles.carga}>
        <PinLoadingIndicator loading={cargando} color={colors.textOnPrimary} compact />
      </View>
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.surface,
    shadowColor: colors.vehiculoContorno,
    shadowOpacity: 0.24,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  letra: {
    color: colors.textOnPrimary,
    fontWeight: fontWeight.bold,
    includeFontPadding: false,
    textAlign: 'center',
  },
  carga: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
