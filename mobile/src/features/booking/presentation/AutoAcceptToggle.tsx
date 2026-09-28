/**
 * "Aceptar automáticamente" row of the trip configuration sheet. When it is on,
 * the backend assigns the first driver who accepts the passenger's fare without
 * waiting for them to choose; counter-offers still wait for the passenger.
 *
 * The switch is drawn here (52×32 track, like the design) because the native
 * Android switch is too small for this row; the whole row is the control.
 */
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

type Props = {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Fare already formatted for the hint (e.g. "25"); omitted while it is invalid. */
  fareLabel?: string;
};

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;
const KNOB = 24;
const KNOB_INSET = (TRACK_HEIGHT - KNOB) / 2;
const KNOB_TRAVEL = TRACK_WIDTH - KNOB - KNOB_INSET * 2;

export function AutoAcceptToggle({ value, onChange, fareLabel }: Props) {
  const { styles, focusStyle } = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  const [offset] = useState(() => new Animated.Value(value ? KNOB_TRAVEL : 0));
  useEffect(() => {
    Animated.timing(offset, {
      toValue: value ? KNOB_TRAVEL : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [offset, value]);

  const hint = fareLabel
    ? `Viaja con el primero que diga «sí» a Bs ${fareLabel}`
    : 'Viaja con el primero que acepte tu precio';

  return (
    <Pressable
      style={[styles.row, focused && focusStyle]}
      onPress={() => onChange(!value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      aria-checked={value}
      accessibilityLabel="Aceptar automáticamente"
      accessibilityHint={hint}>
      <View style={styles.text} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.title}>Aceptar automáticamente</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <View style={[styles.track, value && styles.trackOn]} accessible={false}>
        <Animated.View
          style={[styles.knob, value && styles.knobOn, { transform: [{ translateX: offset }] }]}
        />
      </View>
    </Pressable>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.md - 1, fontWeight: fontWeight.bold, color: colors.text },
  hint: { fontSize: fontSize.xs + 1, color: colors.textSecondary },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    padding: KNOB_INSET,
    backgroundColor: colors.controlBorder,
  },
  trackOn: { backgroundColor: colors.primary },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  knobOn: { backgroundColor: colors.accent },
});
