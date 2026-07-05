/**
 * Overlay efímero "Oferta enviada" (conductor): feedback animado al enviar una
 * oferta (Aceptar / +Bs / monto del keypad). Auto-ocultado a los ~1.2 s; no
 * captura toques (`pointerEvents="none"`) para no bloquear la siguiente oferta.
 *
 * Usa `react-native-reanimated` (corre en el hilo nativo). Análogo visual al
 * `ConfirmationOverlay` del pasajero, pero para el gesto de ofertar.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

const AUTO_HIDE_MS = 1200;

export function OfferSentOverlay({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
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
          <Ionicons name="checkmark-circle" size={48} color={colors.success} />
        </View>
        <Text style={styles.title}>Oferta enviada</Text>
        <Text style={styles.hint}>Esperando al pasajero…</Text>
      </Animated.View>
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
    zIndex: 90,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
    width: 260,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    backgroundColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
});
