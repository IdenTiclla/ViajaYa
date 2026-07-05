/**
 * Overlay de confirmación: se muestra al aceptar una oferta (el viaje quedó
 * asignado). Ícono verde con rebote; avanza al **tap** del usuario (tras un
 * mínimo de ~500 ms para evitar un toque accidental) o, como respaldo, se
 * auto-oculta a los 3 s. Al terminar llama a `onDone` (navega al viaje).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

const MIN_DISPLAY_MS = 500;
const FALLBACK_MS = 3000;

export function ConfirmationOverlay({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const [scale] = useState(() => new Animated.Value(0));
  // Ref (no state): el onPress la lee al tap; evita re-renders en cascada.
  const canDismissRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0);
    canDismissRef.current = false;
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
    const minTimer = setTimeout(() => {
      canDismissRef.current = true;
    }, MIN_DISPLAY_MS);
    const fallback = setTimeout(onDone, FALLBACK_MS);
    return () => {
      anim.stop();
      clearTimeout(minTimer);
      clearTimeout(fallback);
    };
    // visible dispara la animación; onDone es estable (useCallback en el padre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <Pressable
      style={styles.overlay}
      onPress={() => {
        if (canDismissRef.current) onDone();
      }}
      accessibilityRole="alert"
      accessibilityLabel="Viaje confirmado. Toca para continuar.">
      <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle" size={56} color={colors.success} />
        </View>
        <Text style={styles.title}>¡Viaje Confirmado!</Text>
        <Text style={styles.hint}>Tu conductor está en camino</Text>
        <Text style={styles.tapHint}>Toca para continuar</Text>
      </Animated.View>
    </Pressable>
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
  tapHint: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold, marginTop: spacing.xs },
});
