/**
 * Full-screen "¡Viaje confirmado!" that opens stage 2 for both roles: the
 * passenger sees who is coming and the plate; the driver sees who accepted,
 * the price and where to pick them up.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { vehicleLabel } from '@/features/auth/domain/vehicleCatalog';
import { Button, PersonAvatar } from '@/shared/components';
import { formatBolivianos } from '../domain/money';
import { serviceNouns } from '../domain/serviceNouns';
import type { Ride } from '../domain/types';
import { PlateBadge } from './TripParts';
import { TripProgress } from './TripProgress';

type Props = {
  ride: Ride | null;
  role: 'passenger' | 'driver';
  actionLabel: string;
  onContinue: () => void;
  /** Distance/time to the pickup, when the driver already knows it. */
  pickupHint?: string | null;
  /** Continue on its own after this long, when nobody taps the button. */
  autoContinueMs?: number;
};

export function RideConfirmedScreen({ ride, role, actionLabel, onContinue, pickupHint, autoContinueMs }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const reducedMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(reducedMotion ? 1 : 0.4));

  useEffect(() => {
    if (reducedMotion) return;
    const animation = Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, scale]);

  const continueRef = useRef(onContinue);
  useEffect(() => {
    continueRef.current = onContinue;
  });
  useEffect(() => {
    if (autoContinueMs == null) return;
    const timer = setTimeout(() => continueRef.current(), autoContinueMs);
    return () => clearTimeout(timer);
  }, [autoContinueMs]);

  const driver = ride?.driver ?? null;
  const price = ride ? formatBolivianos(ride.acceptedPrice ?? ride.fare) : null;
  const payment = ride?.payment === 'qr' ? 'QR' : 'Efectivo';
  const nouns = ride ? serviceNouns(ride.service) : null;
  const headline = role === 'passenger'
    ? driver ? `${firstName(driver.fullName)} llega${ride?.acceptedEtaMin ? ` en ${ride.acceptedEtaMin} min` : ' pronto'}` : 'Tu conductor está en camino'
    : ride ? `${firstName(ride.rider.fullName)} aceptó tu oferta` : 'Aceptaron tu oferta';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <TripProgress status="accepted" onBrand />
        <View style={styles.hero} accessibilityLiveRegion="assertive">
          <Animated.View style={[styles.ring, { transform: [{ scale }] }]}>
            <View style={styles.check}>
              <Ionicons name="checkmark" size={56} color={colors.textOnAccent} />
            </View>
          </Animated.View>
          <Text accessibilityRole="header" style={styles.title}>¡Viaje confirmado!</Text>
          <Text style={styles.subtitle}>{headline}</Text>
        </View>

        {ride && (
          <View style={styles.card}>
            <View style={styles.personRow}>
              <PersonAvatar name={role === 'passenger' ? driver?.fullName : ride.rider.fullName} size={48} />
              <View style={styles.personInfo}>
                <Text style={styles.name}>{role === 'passenger' ? driver?.fullName ?? 'Tu conductor' : ride.rider.fullName}</Text>
                <Text style={styles.meta}>
                  {role === 'passenger'
                    ? [driver?.rating != null ? `★ ${driver.rating.toFixed(1)}` : null,
                        driver ? [vehicleLabel(driver.vehicleType), driver.vehicleModel].filter(Boolean).join(' · ') : null]
                        .filter(Boolean).join(' · ')
                    : [nouns?.customerTitle, ride.rider.rating != null ? `★ ${ride.rider.rating.toFixed(1)}` : null]
                        .filter(Boolean).join(' · ')}
                </Text>
              </View>
              {role === 'driver' && (
                <View style={styles.priceBlock}>
                  <Text style={styles.price}>Bs {price}</Text>
                  <Text style={styles.payment}>{payment}</Text>
                </View>
              )}
            </View>

            {role === 'passenger' && driver?.plate ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Busca esta placa</Text>
                <PlateBadge plate={driver.plate} large />
              </View>
            ) : null}
            {role === 'passenger' && (
              <View style={styles.summaryRow}>
                <Text style={styles.infoLabel}>Precio acordado</Text>
                <Text style={styles.summaryValue}>Bs {price} · {payment}</Text>
              </View>
            )}
            {role === 'driver' && (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={22} color={colors.primary} />
                <View style={styles.personInfo}>
                  <Text style={styles.summaryValue}>Recoge en {ride.origin.name}</Text>
                  {!!pickupHint && <Text style={styles.meta}>{pickupHint}</Text>}
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button title={actionLabel} variant="accent"
          leadingIcon={role === 'driver' ? 'navigate' : undefined}
          trailingIcon={role === 'passenger' ? 'arrow-forward' : undefined}
          onPress={onContinue} />
      </View>
    </SafeAreaView>
  );
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  ring: {
    width: 132,
    height: 132,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  check: {
    width: 100,
    height: 100,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.textOnBrand, textAlign: 'center' },
  subtitle: { fontSize: fontSize.lg, color: colors.textOnBrand, opacity: 0.9, textAlign: 'center' },
  card: { gap: spacing.md, padding: spacing.md, borderRadius: 20, backgroundColor: colors.surface },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  personInfo: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.textSecondary },
  priceBlock: { alignItems: 'flex-end' },
  price: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  payment: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.success },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  infoLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  summaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
});
