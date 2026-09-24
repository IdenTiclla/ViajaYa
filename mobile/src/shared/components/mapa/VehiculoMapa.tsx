import { StyleSheet, View } from 'react-native';

import { useEstilos, type Tema } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';

/** Dibujo cenital propio: el frente apunta al norte antes de aplicar el rumbo. */
export function VehiculoMapa({ tipo }: { tipo: VehicleType }) {
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
      ) : tipo === 'truck' ? (
        <>
          <View style={[styles.ruedas, styles.ruedasCamionDelanteras]} />
          <View style={[styles.ruedas, styles.ruedasCamionTraseras]} />
          <View style={styles.cabina}>
            <View style={[styles.faro, styles.izquierdo]} />
            <View style={[styles.faro, styles.derecho]} />
            <View style={styles.parabrisasCabina}>
              <View style={styles.reflejo} />
            </View>
          </View>
          <View style={styles.caja}>
            <View style={[styles.piloto, styles.izquierdo]} />
            <View style={[styles.piloto, styles.derecho]} />
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

// Compact top-down scale (~street width at city zoom); no background disc.
const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  marco: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  carroceria: {
    width: 14, height: 24, borderRadius: 4.5, borderWidth: 1,
    borderColor: colors.vehiculoContorno, backgroundColor: colors.accent,
  },
  ruedas: {
    position: 'absolute', width: 17, height: 4, borderRadius: 1.5,
    backgroundColor: colors.vehiculoContorno,
  },
  ruedasDelanteras: { top: 6 },
  ruedasTraseras: { bottom: 5 },
  ruedasCamionDelanteras: { top: 4 },
  ruedasCamionTraseras: { bottom: 3 },
  cabina: {
    position: 'absolute', top: 1, width: 14.5, height: 8.5, borderTopLeftRadius: 4,
    borderTopRightRadius: 4, borderBottomLeftRadius: 1, borderBottomRightRadius: 1,
    borderWidth: 1, borderColor: colors.vehiculoContorno, backgroundColor: colors.accent,
  },
  parabrisasCabina: {
    position: 'absolute', top: 3, left: 1.5, right: 1.5, height: 3,
    borderRadius: 1, backgroundColor: colors.vehiculoContorno, overflow: 'hidden',
  },
  caja: {
    position: 'absolute', top: 10, width: 15.5, height: 16.5, borderRadius: 2,
    borderWidth: 1, borderColor: colors.vehiculoContorno, backgroundColor: colors.surface,
  },
  espejos: {
    position: 'absolute', top: 9, width: 19, height: 2, borderRadius: 1,
    backgroundColor: colors.vehiculoContorno,
  },
  parabrisas: {
    position: 'absolute', top: 5, left: 1.5, right: 1.5, height: 4,
    borderTopLeftRadius: 2.5, borderTopRightRadius: 2.5, borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1, backgroundColor: colors.vehiculoContorno,
    overflow: 'hidden',
  },
  reflejo: {
    position: 'absolute', top: 1, left: 2, right: 2, height: 1,
    borderRadius: 0.5, backgroundColor: colors.vehiculoReflejo,
  },
  distintivoTaxi: {
    position: 'absolute', top: 11, left: 4, width: 4, height: 2,
    borderRadius: 0.5, backgroundColor: colors.vehiculoContorno,
  },
  ventanaTrasera: {
    position: 'absolute', bottom: 3.5, left: 2, right: 2, height: 3,
    borderRadius: 1, backgroundColor: colors.vehiculoContorno,
  },
  faro: {
    position: 'absolute', top: 1, width: 2.5, height: 1.5,
    borderRadius: 0.5, backgroundColor: colors.vehiculoReflejo,
  },
  piloto: {
    position: 'absolute', bottom: 1, width: 2.5, height: 1.5,
    borderRadius: 0.5, backgroundColor: colors.danger,
  },
  izquierdo: { left: 1.5 },
  derecho: { right: 1.5 },
  ruedaMoto: {
    position: 'absolute', width: 3.5, height: 6,
    borderRadius: 2, backgroundColor: colors.vehiculoContorno,
  },
  ruedaDelantera: { top: 3 },
  ruedaTrasera: { bottom: 3 },
  manillar: {
    position: 'absolute', top: 9, width: 16, height: 2.5,
    borderRadius: 1.5, backgroundColor: colors.vehiculoContorno,
  },
  moto: {
    width: 8.5, height: 18, borderRadius: 4.5, borderWidth: 1,
    backgroundColor: colors.accent, borderColor: colors.vehiculoContorno,
  },
  faroMoto: {
    position: 'absolute', top: 1.5, left: 1.5, right: 1.5, height: 2,
    borderRadius: 1, backgroundColor: colors.vehiculoReflejo,
  },
  asiento: {
    position: 'absolute', top: 7, bottom: 1.5, left: 1.5, right: 1.5,
    borderRadius: 2, backgroundColor: colors.vehiculoContorno,
  },
});
