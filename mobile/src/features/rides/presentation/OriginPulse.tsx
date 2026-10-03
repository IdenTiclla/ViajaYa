/**
 * Expanding waves around the pickup point while the passenger waits for
 * offers. Decorative: the pin itself is the native map marker. With reduced
 * motion it shows the same rings standing still.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { radius, useTheme } from '@/core/theme';

const WAVES = 3;
const WAVE_DURATION_MS = 2400;

export function OriginPulse({ size = 200 }: { size?: number }) {
  const reducedMotion = useReducedMotion();
  return (
    <View style={{ width: size, height: size }} pointerEvents="none"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: WAVES }, (_, index) => (
        <Wave key={index} index={index} size={size} still={reducedMotion} />
      ))}
    </View>
  );
}

function Wave({ index, size, still }: { index: number; size: number; still: boolean }) {
  const { colors } = useTheme();
  const progress = useSharedValue(still ? (index + 1) / WAVES : 0);

  useEffect(() => {
    if (still) {
      progress.set((index + 1) / WAVES);
      return;
    }
    progress.set(0);
    progress.set(withDelay((WAVE_DURATION_MS / WAVES) * index,
      withRepeat(withTiming(1, { duration: WAVE_DURATION_MS, easing: Easing.out(Easing.quad) }), -1, false)));
    return () => cancelAnimation(progress);
  }, [still, index, progress]);

  const style = useWaveStyle(progress, still);
  return (
    <Animated.View style={[styles.wave, style, { width: size, height: size, borderColor: colors.primary }]}>
      <View style={[styles.fill, { backgroundColor: colors.primary }]} />
    </Animated.View>
  );
}

function useWaveStyle(progress: SharedValue<number>, still: boolean) {
  return useAnimatedStyle(() => ({
    // Still rings fade outwards like the canvas; moving ones fade as they grow.
    opacity: still ? 0.35 - progress.value * 0.2 : 0.5 * (1 - progress.value),
    transform: [{ scale: 0.12 + progress.value * 0.88 }],
  }));
}

const styles = StyleSheet.create({
  wave: {
    position: 'absolute',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  // Same hue as the ring, much fainter, like the canvas.
  fill: { ...StyleSheet.absoluteFill, opacity: 0.3 },
});
