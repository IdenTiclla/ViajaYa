/**
 * Radar de búsqueda del conductor.
 *
 * El disco permanece fijo sobre el mapa y un sector triangular de barrido rota
 * sobre la retícula. La flecha central indica la orientación real del vehículo; no hay
 * puntos artificiales que puedan confundirse con solicitudes reales.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius } from '@/core/theme';

const SIZE = 365;
const SWEEP_DURATION_MS = 5000;
const NAVIGATE_OFFSET_DEG = 45;
const ROTATE_DURATION_MS = 350;

export function RadarPulse({ heading = null }: { heading?: number | null }) {
  const reduceMotion = useReducedMotion();
  const sweep = useSharedValue(0);
  const scanningEnabled = useSharedValue(reduceMotion ? 0 : 1);
  const corePulse = useSharedValue(0);
  const headingRotation = useSharedValue(0);
  const headingRef = useRef(0);

  // El ángulo se incrementa en cada frame en el hilo de UI. Al usar módulo 360
  // no se reinicia una animación al terminar la vuelta y el barrido queda fluido.
  useFrameCallback((frameInfo) => {
    if (!scanningEnabled.value || frameInfo.timeSincePreviousFrame == null) return;
    sweep.value = (sweep.value + (frameInfo.timeSincePreviousFrame * 360) / SWEEP_DURATION_MS) % 360;
  });

  useEffect(() => {
    scanningEnabled.set(reduceMotion ? 0 : 1);
    if (reduceMotion) {
      sweep.set(0);
      corePulse.value = 0;
      return;
    }

    corePulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(corePulse);
    };
  }, [corePulse, reduceMotion, scanningEnabled, sweep]);

  useEffect(() => {
    if (heading == null) return;
    const target = heading - NAVIGATE_OFFSET_DEG;
    const delta = (((target - headingRef.current) % 360) + 540) % 360 - 180;
    const next = headingRef.current + delta;
    headingRef.current = next;
    headingRotation.value = reduceMotion
      ? next
      : withTiming(next, { duration: ROTATE_DURATION_MS, easing: Easing.out(Easing.cubic) });
  }, [heading, headingRotation, reduceMotion]);

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.18 : 1,
    transform: [{ rotate: `${sweep.value}deg` }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: reduceMotion ? 1 : 1 + corePulse.value * 0.07 },
      { rotate: `${headingRotation.value}deg` },
    ],
  }));

  return (
    <View style={styles.root} accessibilityLabel="Radar buscando solicitudes cercanas">
      <Animated.View style={[styles.sweep, sweepStyle]}>
        <View style={styles.sweepArea} />
      </Animated.View>

      <Animated.View style={[styles.core, coreStyle]}>
        <Ionicons name="navigate" size={11} color={colors.textOnPrimary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radius.pill,
  },
  sweep: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
  },
  sweepArea: {
    position: 'absolute',
    top: SIZE / 2,
    left: 0,
    width: 0,
    height: 0,
    borderLeftWidth: SIZE / 2,
    borderRightWidth: SIZE / 2,
    borderBottomWidth: SIZE / 2,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(245,197,24,0.3)',
  },
  core: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.35,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
});
