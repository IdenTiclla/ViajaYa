/**
 * Ephemeral "Oferta enviada" overlay (driver): animated feedback when sending an
 * offer (Aceptar / +Bs / keypad amount). Auto-hidden after ~1.2 s; it does not
 * capture touches (`pointerEvents="none"`) so it does not block the next offer.
 *
 * Uses `react-native-reanimated` (runs on the native thread). Visual counterpart of the
 * passenger's `ConfirmationOverlay`, but for the offer gesture.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

const AUTO_HIDE_MS = 1200;

export function OfferSentOverlay({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDone, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [visible, onDone]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(160)}
        style={styles.card}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>Oferta enviada</Text>
          <Text style={styles.hint}>Puedes seguir ofertando a otros pasajeros</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  overlay: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, zIndex: 90, alignItems: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.success, padding: spacing.sm, flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, width: '100%', maxWidth: 400, elevation: 6 },
  iconCircle: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.successSoft,
    alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  hint: { fontSize: fontSize.xs, color: colors.textSecondary },
});
