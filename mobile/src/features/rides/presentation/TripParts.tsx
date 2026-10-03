/** Small presentational blocks shared by the passenger and driver ride screens. */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { formatBolivianos } from '../domain/money';
import type { Ride } from '../domain/types';

/** Elapsed m:ss since an ISO instant (never negative), for the pickup wait. */
export function formatElapsed(since: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The vehicle plate drawn like a plate, so the passenger can match it at a glance. */
export function PlateBadge({ plate, large = false }: { plate: string; large?: boolean }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.plate} accessible accessibilityLabel={`Placa ${plate}`}>
      <Text style={[styles.plateText, large && styles.plateTextLarge]}>{plate}</Text>
    </View>
  );
}

/** Round icon-only action (call, message) with the 48 dp touch target. */
export function ContactIconButton({ icon, label, onPress, disabled, onSurface = false }: {
  icon: IoniconsIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Draws over a muted card, so the button uses the surface color. */
  onSurface?: boolean;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={[styles.iconButton, onSurface && styles.iconButtonOnSurface, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}>
      <Ionicons name={icon} size={20} color={colors.primary} />
    </TouchableOpacity>
  );
}

/** Agreed price and payment method; the driver sees it as what to collect. */
export function PaymentNote({ ride, role }: { ride: Ride; role: 'passenger' | 'driver' }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const price = formatBolivianos(ride.acceptedPrice ?? ride.fare);
  const method = ride.payment === 'qr' ? 'con QR' : 'en efectivo';
  const driver = role === 'driver';
  return (
    <View style={[styles.payment, driver && styles.paymentDriver]}>
      <Ionicons name={ride.payment === 'qr' ? 'qr-code-outline' : 'cash-outline'} size={22}
        color={driver ? colors.warning : colors.success} />
      <Text style={[styles.paymentText, driver && styles.paymentTextDriver]}>
        {driver ? 'Al llegar cobra ' : 'Al llegar pagas '}
        <Text style={styles.bold}>Bs {price}</Text> {method}
      </Text>
    </View>
  );
}

/** One-line A → B summary with the agreed price. */
export function RouteLine({ ride }: { ride: Ride }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.routeLine}
      accessible accessibilityLabel={`De ${ride.origin.name} a ${ride.destination.name}, Bs ${formatBolivianos(ride.acceptedPrice ?? ride.fare)}`}>
      <View style={styles.routeDot}><Text style={styles.routeDotText}>A</Text></View>
      <Text style={styles.routePlace} numberOfLines={1}>{ride.origin.name}</Text>
      <View style={[styles.routeDot, styles.routeDotB]}><Text style={[styles.routeDotText, styles.routeDotTextB]}>B</Text></View>
      <Text style={styles.routePlace} numberOfLines={1}>{ride.destination.name}</Text>
      <Text style={styles.routePrice}>Bs {formatBolivianos(ride.acceptedPrice ?? ride.fare)}</Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  routeLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  routeDot: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeDotB: { backgroundColor: colors.text },
  routeDotText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.textOnBrand },
  routeDotTextB: { color: colors.background },
  routePlace: { flexShrink: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  routePrice: { marginLeft: 'auto', paddingLeft: spacing.xs, fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  plate: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.surface,
  },
  plateText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text, letterSpacing: 1.2 },
  plateTextLarge: { fontSize: fontSize.lg, letterSpacing: 1.5 },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonOnSurface: { backgroundColor: colors.surface },
  disabled: { opacity: 0.4 },
  payment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentDriver: { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft },
  paymentText: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  paymentTextDriver: { color: colors.text },
  bold: { fontWeight: fontWeight.bold },
});
