import { StyleSheet, View } from 'react-native';

import { useEstilos, type Tema } from '@/core/theme';

/** Dibujo cenital propio: el frente apunta al norte antes de aplicar el rumbo. */
export function VehiculoMapa({ tipo }: { tipo: 'taxi' | 'moto' }) {
  const { styles } = useEstilos(crearEstilos);
  return (
    <View
      style={styles.marco}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {tipo === 'moto' ? (
        <>
          <View style={[styles.ruedaMoto, styles.ruedaDelantera]} />
          <View style={[styles.ruedaMoto, styles.ruedaTrasera]} />
          <View style={styles.manillar} />
          <View style={styles.moto}>
            <View style={styles.faroMoto} />
            <View style={styles.asiento} />
          </View>
        </>
      ) : (
        <>
          <View style={[styles.ruedas, styles.ruedasDelanteras]} />
          <View style={[styles.ruedas, styles.ruedasTraseras]} />
          <View style={styles.espejos} />
          <View style={styles.carroceria}>
            <View style={[styles.faro, styles.izquierdo]} />
            <View style={[styles.faro, styles.derecho]} />
            <View style={styles.parabrisas}>
              <View style={styles.reflejo} />
            </View>
            <View style={styles.distintivoTaxi} />
            <View style={styles.ventanaTrasera} />
            <View style={[styles.piloto, styles.izquierdo]} />
            <View style={[styles.piloto, styles.derecho]} />
          </View>
        </>
      )}
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  marco: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  carroceria: {
    width: 24, height: 38, borderRadius: 7, borderWidth: 1.5,
    borderColor: colors.vehiculoContorno, backgroundColor: colors.accent,
  },
  ruedas: {
    position: 'absolute', width: 29, height: 7, borderRadius: 2,
    backgroundColor: colors.vehiculoContorno,
  },
  ruedasDelanteras: { top: 10 },
  ruedasTraseras: { bottom: 8 },
  espejos: {
    position: 'absolute', top: 16, width: 32, height: 3, borderRadius: 2,
    backgroundColor: colors.vehiculoContorno,
  },
  parabrisas: {
    position: 'absolute', top: 8, left: 2, right: 2, height: 7,
    borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2, backgroundColor: colors.vehiculoContorno,
    overflow: 'hidden',
  },
  reflejo: {
    position: 'absolute', top: 1.5, left: 3, right: 3, height: 1.5,
    borderRadius: 1, backgroundColor: colors.vehiculoReflejo,
  },
  distintivoTaxi: {
    position: 'absolute', top: 18, left: 7, width: 7, height: 3,
    borderRadius: 1, backgroundColor: colors.vehiculoContorno,
  },
  ventanaTrasera: {
    position: 'absolute', bottom: 6, left: 3, right: 3, height: 5,
    borderRadius: 2, backgroundColor: colors.vehiculoContorno,
  },
  faro: {
    position: 'absolute', top: 2, width: 4, height: 2,
    borderRadius: 1, backgroundColor: colors.vehiculoReflejo,
  },
  piloto: {
    position: 'absolute', bottom: 2, width: 4, height: 2,
    borderRadius: 1, backgroundColor: colors.danger,
  },
  izquierdo: { left: 2 },
  derecho: { right: 2 },
  ruedaMoto: {
    position: 'absolute', width: 6, height: 10,
    borderRadius: 3, backgroundColor: colors.vehiculoContorno,
  },
  ruedaDelantera: { top: 1 },
  ruedaTrasera: { bottom: 1 },
  manillar: {
    position: 'absolute', top: 11, width: 26, height: 4,
    borderRadius: 2, backgroundColor: colors.vehiculoContorno,
  },
  moto: {
    width: 14, height: 30, borderRadius: 7, borderWidth: 1.5,
    backgroundColor: colors.accent, borderColor: colors.vehiculoContorno,
  },
  faroMoto: {
    position: 'absolute', top: 2, left: 2.5, right: 2.5, height: 3,
    borderRadius: 2, backgroundColor: colors.vehiculoReflejo,
  },
  asiento: {
    position: 'absolute', top: 12, bottom: 2, left: 2, right: 2,
    borderRadius: 3, backgroundColor: colors.vehiculoContorno,
  },
});
