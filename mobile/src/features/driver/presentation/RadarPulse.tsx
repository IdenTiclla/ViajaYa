/**
 * Pulso radar Material-You: un **halo** de fondo suave + anillos concéntricos que
 * se expanden y desvanecen (3, desfasados) con relleno translúcido para dar
 * volumen a la onda, más un núcleo con el ícono `navigate` que **late** y **rota
 * según el rumbo** (`heading`, 0 = norte).
 *
 * Es un overlay de pantalla (no un marker): la animación es fluida nativa
 * (`Animated.loop`/`timing` + `useNativeDriver:true`). Como el mapa mantiene al
 * conductor centrado, el pulso centrado coincide con su ubicación.
 *
 * Tamaño contenido para no tapar las calles. La rotación va por el camino más
 * corto (wrap de 360°). `navigate` apunta al noreste por defecto, así que
 * restamos 45° para que heading=0 sea el norte.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/core/theme';

const SIZE = 80;
const RING_COUNT = 4;
const RING_DURATION_MS = 2700;
const RING_STAGGER_MS = 675;
const NAVIGATE_OFFSET_DEG = 45;
const ROTATE_DURATION_MS = 400;

export function RadarPulse({ heading = null }: { heading?: number | null }) {
  const [rings] = useState<Animated.Value[]>(
    () => Array.from({ length: RING_COUNT }, () => new Animated.Value(0)),
  );
  const [core] = useState(() => new Animated.Value(0));
  const [rotate] = useState(() => new Animated.Value(0));
  const rotateRef = useRef(0);

  useEffect(() => {
    const ringLoop = (value: Animated.Value) =>
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: RING_DURATION_MS,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      );
    const loops = rings.map(ringLoop);
    const timers: ReturnType<typeof setTimeout>[] = [];
    loops.forEach((loop, i) => {
      timers.push(setTimeout(() => loop.start(), i * RING_STAGGER_MS));
    });

    const coreLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(core, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(core, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    coreLoop.start();

    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((loop) => loop.stop());
      coreLoop.stop();
    };
  }, [rings, core]);

  useEffect(() => {
    if (heading == null) return;
    const target = heading - NAVIGATE_OFFSET_DEG;
    const delta = (((target - rotateRef.current) % 360) + 540) % 360 - 180;
    const next = rotateRef.current + delta;
    rotateRef.current = next;
    Animated.timing(rotate, {
      toValue: next,
      duration: ROTATE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [heading, rotate]);

  const ringStyle = (value: Animated.Value) => ({
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.4] }) }],
    opacity: value.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0.7, 0] }),
  });

  return (
    <View style={styles.root}>
      {/* Halo de fondo suave para dar contexto al radar. */}
      <View style={styles.halo} />

      {rings.map((value, i) => (
        <Animated.View key={i} style={[styles.ring, ringStyle(value)]} />
      ))}

      <Animated.View
        style={[
          styles.core,
          {
            transform: [
              { scale: core.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
              { rotate: rotate.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) },
            ],
          },
        ]}>
        <Ionicons name="navigate" size={12} color={colors.textOnPrimary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,48,140,0.2)',
  },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: 'rgba(22,48,140,0.35)',
  },
  core: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});
