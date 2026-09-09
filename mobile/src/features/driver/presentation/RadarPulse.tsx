/** Barrido decorativo de búsqueda; la ubicación la representa el marcador nativo. */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';

import { radius } from '@/core/theme';

const SIZE = 365;
const SWEEP_DURATION_MS = 5000;

export function RadarPulse() {
  const reduceMotion = useReducedMotion();
  const sweep = useSharedValue(0);
  const scanningEnabled = useSharedValue(reduceMotion ? 0 : 1);

  useFrameCallback((frameInfo) => {
    if (!scanningEnabled.value || frameInfo.timeSincePreviousFrame == null) return;
    sweep.value = (sweep.value + (frameInfo.timeSincePreviousFrame * 360) / SWEEP_DURATION_MS) % 360;
  });
  useEffect(() => {
    scanningEnabled.set(reduceMotion ? 0 : 1);
    if (reduceMotion) sweep.set(0);
  }, [reduceMotion, scanningEnabled, sweep]);
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.18 : 1,
    transform: [{ rotate: `${sweep.value}deg` }],
  }));

  return (
    <View style={styles.root} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.sweep, sweepStyle]}><View style={styles.sweepArea} /></Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: SIZE, height: SIZE, overflow: 'hidden', borderRadius: radius.pill },
  sweep: { position: 'absolute', width: SIZE, height: SIZE },
  sweepArea: {
    position: 'absolute', top: SIZE / 2, left: 0, width: 0, height: 0,
    borderLeftWidth: SIZE / 2, borderRightWidth: SIZE / 2, borderBottomWidth: SIZE / 2,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: 'rgba(245,197,24,0.3)',
  },
});
