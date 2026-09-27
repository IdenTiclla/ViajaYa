/**
 * Offer and payment block of the trip configuration sheet: the passenger's fare
 * (typed or adjusted with +/−) next to the two payment methods. With large text
 * the payment buttons move below the fare so nothing gets clipped.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { stepFare } from '@/features/booking/domain/fareStep';
import type { PaymentMethod } from '@/features/booking/domain/types';
import {
  getTripOptionIcon,
  type TripOptionIconName,
} from '@/features/booking/presentation/tripOptionIcons';

type Props = {
  fare: string;
  onFareChange: (fare: string) => void;
  onFareBlur?: () => void;
  payment: PaymentMethod;
  onPaymentChange: (payment: PaymentMethod) => void;
};

const PAYMENTS: readonly {
  id: PaymentMethod;
  label: string;
  icon: TripOptionIconName;
  accessibilityLabel: string;
}[] = [
  { id: 'cash', label: 'Efectivo', icon: 'cash', accessibilityLabel: 'Pagar con efectivo' },
  { id: 'qr', label: 'Pago QR', icon: 'qr', accessibilityLabel: 'Pagar con QR' },
];

export function FareAndPaymentPicker({
  fare,
  onFareChange,
  onFareBlur,
  payment,
  onPaymentChange,
}: Props) {
  const { colors, styles, mode } = useThemedStyles(createStyles);
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;

  return (
    <View style={[styles.row, stacked && styles.stacked]}>
      <View style={styles.fareCard}>
        <View style={styles.cashBadge}>
          <Image source={getTripOptionIcon('cash', mode)} style={styles.cashIcon} accessible={false} />
        </View>
        <View style={styles.fareText}>
          <Text style={styles.fareLabel}>Tu oferta</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>Bs</Text>
            <TextInput
              value={fare}
              onChangeText={onFareChange}
              onBlur={onFareBlur}
              placeholder="30"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={9}
              style={styles.amount}
              accessibilityLabel="Monto de tu oferta en bolivianos"
            />
          </View>
        </View>
        <View style={styles.stepper}>
          <Pressable
            style={({ pressed }) => [styles.step, styles.stepUp, pressed && styles.pressed]}
            onPress={() => onFareChange(stepFare(fare, 1))}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Subir oferta un boliviano">
            <Ionicons name="add" size={18} color={colors.textOnPrimary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.step, styles.stepDown, pressed && styles.pressed]}
            onPress={() => onFareChange(stepFare(fare, -1))}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Bajar oferta un boliviano">
            <Ionicons name="remove" size={18} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      <View style={[styles.payments, stacked && styles.paymentsStacked]} accessibilityRole="radiogroup"
        accessibilityLabel="Método de pago">
        {PAYMENTS.map((option) => {
          const selected = option.id === payment;
          return (
            <Pressable
              key={option.id}
              style={({ pressed }) => [
                styles.payment,
                stacked && styles.paymentStacked,
                selected && styles.paymentSelected,
                pressed && styles.pressed,
              ]}
              onPress={() => { if (!selected) onPaymentChange(option.id); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              accessibilityLabel={option.accessibilityLabel}>
              <Image source={getTripOptionIcon(option.icon, mode)} style={styles.paymentIcon} accessible={false} />
              <Text style={[styles.paymentLabel, selected && styles.paymentLabelSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm + 2, alignItems: 'stretch' },
  stacked: { flexDirection: 'column' },
  fareCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: 20,
    backgroundColor: colors.warningSoft,
  },
  cashBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cashIcon: { width: 28, height: 28 },
  fareText: { flex: 1, minWidth: 0 },
  fareLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.warning },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  currency: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  amount: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 26,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  stepper: { gap: 6 },
  step: {
    width: 44,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepUp: { backgroundColor: colors.primary },
  stepDown: { backgroundColor: colors.surface },
  payments: { width: 112, gap: 6 },
  paymentsStacked: { width: '100%', flexDirection: 'row' },
  payment: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  paymentStacked: { minHeight: 48 },
  paymentSelected: { backgroundColor: colors.accent },
  paymentIcon: { width: 20, height: 20 },
  paymentLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textSecondary },
  paymentLabelSelected: { color: colors.textOnAccent },
  pressed: { opacity: 0.85 },
});
