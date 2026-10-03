/**
 * Slide-to-confirm control for decisive actions (the driver advancing a ride,
 * the passenger publishing a request): a deliberate drag replaces the tap, so
 * a stray touch does not trigger it. Screen readers activate it as a regular
 * button.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

const KNOB = 48;
const INSET = 6;
const THRESHOLD = 0.82;
const SUCCESS_FILL = '#167347';

type Props = {
  label: string;
  /** Spoken name; defaults to the label. */
  accessibilityLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  tone?: 'primary' | 'success' | 'accent';
};

export function SwipeToConfirm({
  label, accessibilityLabel, onConfirm, disabled = false, loading = false, loadingLabel, tone = 'primary',
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [trackWidth, setTrackWidth] = useState(0);
  const offset = useSharedValue(0);
  const max = Math.max(0, trackWidth - KNOB - INSET * 2);
  const locked = disabled || loading;
  // Fixed fills (not theme `success`) keep the white label readable in both themes;
  // the yellow accent is the same in both themes and carries dark text.
  const fill = tone === 'success' ? SUCCESS_FILL : tone === 'accent' ? colors.accent : colors.brand;
  const ink = tone === 'accent' ? colors.textOnAccent : colors.textOnBrand;

  const confirm = () => {
    if (!locked) onConfirm();
  };

  const pan = Gesture.Pan()
    .enabled(!locked && max > 0)
    .activeOffsetX(8)
    .onUpdate((event) => {
      offset.value = Math.min(max, Math.max(0, event.translationX));
    })
    .onEnd(() => {
      if (offset.value >= max * THRESHOLD) {
        scheduleOnRN(confirm);
      }
      offset.value = withSpring(0, { damping: 18 });
    });

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: max > 0 ? 1 - (offset.value / max) * 0.8 : 1 }));

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={loading ? loadingLabel ?? label : accessibilityLabel ?? label}
      accessibilityHint="Desliza a la derecha o toca dos veces para confirmar"
      accessibilityState={{ disabled: locked, busy: loading }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') confirm();
      }}
      onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: fill }, locked && styles.locked]}>
      <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={ink} />
            {!!loadingLabel && <Text style={[styles.label, { color: ink }]} numberOfLines={2}>{loadingLabel}</Text>}
          </View>
        ) : (
          <Text style={[styles.label, { color: ink }]} numberOfLines={2}>{label}</Text>
        )}
      </Animated.View>
      {!loading && (
        <Ionicons name="chevron-forward" size={18} color={ink} style={styles.chevrons} />
      )}
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, knobStyle]}>
          <Ionicons name="arrow-forward" size={24} color={tone === 'accent' ? colors.textOnAccent : fill} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  track: {
    minHeight: KNOB + INSET * 2,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  locked: { opacity: 0.6 },
  labelWrap: {
    paddingLeft: KNOB + INSET * 2 + spacing.xs,
    paddingRight: spacing.xl,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  label: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textOnBrand, textAlign: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  chevrons: { position: 'absolute', right: spacing.md, opacity: 0.55 },
  knob: {
    position: 'absolute',
    left: INSET,
    top: INSET,
    width: KNOB,
    height: KNOB,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
