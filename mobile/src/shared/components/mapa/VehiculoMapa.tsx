import { StyleSheet, View } from 'react-native';

import { useThemedStyles, type Theme } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';

/** Our own top-down drawing: the front points north before the heading is applied. */
export function MapVehicle({ kind }: { kind: VehicleType }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View
      style={styles.frame}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {kind === 'moto' ? (
        <>
          <View style={[styles.motoWheel, styles.frontWheel]} />
          <View style={[styles.motoWheel, styles.rearWheel]} />
          <View style={styles.handlebar} />
          <View style={styles.moto}>
            <View style={styles.motoHeadlight} />
            <View style={styles.seat} />
          </View>
        </>
      ) : kind === 'truck' ? (
        <>
          <View style={[styles.wheels, styles.truckFrontWheels]} />
          <View style={[styles.wheels, styles.truckRearWheels]} />
          <View style={styles.cab}>
            <View style={[styles.headlight, styles.left]} />
            <View style={[styles.headlight, styles.right]} />
            <View style={styles.cabWindshield}>
              <View style={styles.reflection} />
            </View>
          </View>
          <View style={styles.cargoBox}>
            <View style={[styles.taillight, styles.left]} />
            <View style={[styles.taillight, styles.right]} />
          </View>
        </>
      ) : (
        <>
          <View style={[styles.wheels, styles.frontWheels]} />
          <View style={[styles.wheels, styles.rearWheels]} />
          <View style={styles.mirrors} />
          <View style={styles.body}>
            <View style={[styles.headlight, styles.left]} />
            <View style={[styles.headlight, styles.right]} />
            <View style={styles.windshield}>
              <View style={styles.reflection} />
            </View>
            <View style={styles.taxiSign} />
            <View style={styles.rearWindow} />
            <View style={[styles.taillight, styles.left]} />
            <View style={[styles.taillight, styles.right]} />
          </View>
        </>
      )}
    </View>
  );
}

// Compact top-down scale (~street width at city zoom); no background disc.
const createStyles = ({ colors }: Theme) => StyleSheet.create({
  frame: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  body: {
    width: 14, height: 24, borderRadius: 4.5, borderWidth: 1,
    borderColor: colors.vehicleOutline, backgroundColor: colors.accent,
  },
  wheels: {
    position: 'absolute', width: 17, height: 4, borderRadius: 1.5,
    backgroundColor: colors.vehicleOutline,
  },
  frontWheels: { top: 6 },
  rearWheels: { bottom: 5 },
  truckFrontWheels: { top: 4 },
  truckRearWheels: { bottom: 3 },
  cab: {
    position: 'absolute', top: 1, width: 14.5, height: 8.5, borderTopLeftRadius: 4,
    borderTopRightRadius: 4, borderBottomLeftRadius: 1, borderBottomRightRadius: 1,
    borderWidth: 1, borderColor: colors.vehicleOutline, backgroundColor: colors.accent,
  },
  cabWindshield: {
    position: 'absolute', top: 3, left: 1.5, right: 1.5, height: 3,
    borderRadius: 1, backgroundColor: colors.vehicleOutline, overflow: 'hidden',
  },
  cargoBox: {
    position: 'absolute', top: 10, width: 15.5, height: 16.5, borderRadius: 2,
    borderWidth: 1, borderColor: colors.vehicleOutline, backgroundColor: colors.surface,
  },
  mirrors: {
    position: 'absolute', top: 9, width: 19, height: 2, borderRadius: 1,
    backgroundColor: colors.vehicleOutline,
  },
  windshield: {
    position: 'absolute', top: 5, left: 1.5, right: 1.5, height: 4,
    borderTopLeftRadius: 2.5, borderTopRightRadius: 2.5, borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1, backgroundColor: colors.vehicleOutline,
    overflow: 'hidden',
  },
  reflection: {
    position: 'absolute', top: 1, left: 2, right: 2, height: 1,
    borderRadius: 0.5, backgroundColor: colors.vehicleReflection,
  },
  taxiSign: {
    position: 'absolute', top: 11, left: 4, width: 4, height: 2,
    borderRadius: 0.5, backgroundColor: colors.vehicleOutline,
  },
  rearWindow: {
    position: 'absolute', bottom: 3.5, left: 2, right: 2, height: 3,
    borderRadius: 1, backgroundColor: colors.vehicleOutline,
  },
  headlight: {
    position: 'absolute', top: 1, width: 2.5, height: 1.5,
    borderRadius: 0.5, backgroundColor: colors.vehicleReflection,
  },
  taillight: {
    position: 'absolute', bottom: 1, width: 2.5, height: 1.5,
    borderRadius: 0.5, backgroundColor: colors.danger,
  },
  left: { left: 1.5 },
  right: { right: 1.5 },
  motoWheel: {
    position: 'absolute', width: 3.5, height: 6,
    borderRadius: 2, backgroundColor: colors.vehicleOutline,
  },
  frontWheel: { top: 3 },
  rearWheel: { bottom: 3 },
  handlebar: {
    position: 'absolute', top: 9, width: 16, height: 2.5,
    borderRadius: 1.5, backgroundColor: colors.vehicleOutline,
  },
  moto: {
    width: 8.5, height: 18, borderRadius: 4.5, borderWidth: 1,
    backgroundColor: colors.accent, borderColor: colors.vehicleOutline,
  },
  motoHeadlight: {
    position: 'absolute', top: 1.5, left: 1.5, right: 1.5, height: 2,
    borderRadius: 1, backgroundColor: colors.vehicleReflection,
  },
  seat: {
    position: 'absolute', top: 7, bottom: 1.5, left: 1.5, right: 1.5,
    borderRadius: 2, backgroundColor: colors.vehicleOutline,
  },
});
