/**
 * Overlay de confirmación: se muestra al aceptar una oferta (el viaje quedó
 * asignado). Ícono verde con rebote, mensaje y auto-ocultado; al terminar llama
 * `onDone` (para navegar al viaje en curso).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

export function ConfirmationOverlay({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const [scale] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.15,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 160,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    const timeout = setTimeout(onDone, 1600);
    return () => {
      anim.stop();
      clearTimeout(timeout);
    };
    // visible dispara la animación; onDone es estable (useCallback en el padre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} accessibilityRole="alert" accessibilityLabel="Viaje confirmado">
      <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle" size={56} color={colors.success} />
        </View>
        <Text style={styles.title}>¡Viaje Confirmado!</Text>
        <Text style={styles.hint}>Tu conductor está en camino</Text>
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
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
    width: 280,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  hint: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
});
