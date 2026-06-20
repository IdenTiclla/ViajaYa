/**
 * Pulso radar Material-You: anillos concéntricos que se expanden y desvanecen
 * (3, desfasados) más un núcleo con el ícono `navigate` que **late** y **rota
 * según el rumbo** (`heading`, 0 = norte) para seguir la trayectoria del vehículo.
 *
 * Es un overlay de pantalla (no un marker): así las animaciones son fluidas
 * nativas (`Animated.loop`/`timing` + `useNativeDriver:true`). Como el mapa
 * mantiene al conductor centrado, el pulso centrado coincide con su ubicación.
 *
 * La rotación se anima por el **camino más corto** (manejando el wrap de 360°,
 * p. ej. 350°→10° gira +20° y no −340°). `navigate` apunta al noreste por
 * defecto, así que restamos 45° para que heading=0 sea el norte.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/core/theme';

const RING_COUNT = 3;
const RING_DURATION_MS = 2700;
const RING_STAGGER_MS = 900;
const NAVIGATE_OFFSET_DEG = 45; // el ícono apunta al noreste por defecto
const ROTATE_DURATION_MS = 400;

export function RadarPulse({ heading = null }: { heading?: number | null }) {
  const [rings] = useState<Animated.Value[]>(
    () => Array.from({ length: RING_COUNT }, () => new Animated.Value(0)),
  );
  const [core] = useState(() => new Animated.Value(0));
  const [rotate] = useState(() => new Animated.Value(0));
  const rotateRef = useRef(0); // ángulo acumulado (sin modularizar) para animar sin saltos

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

  // Rota al nuevo rumbo por el camino más corto (sin saltos en el wrap de 360°).
  useEffect(() => {
    if (heading == null) return; // conserva el último rumbo conocido
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
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.4] }) }],
    opacity: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 0.2, 0] }),
  });

  return (
    <View style={styles.root}>
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
        <Ionicons name="navigate" size={26} color={colors.textOnPrimary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  core: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
});
