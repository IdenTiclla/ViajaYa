/**
 * Top banner with a one-tap fix: «No pudimos ubicarte. Toca para encender la ubicación.»
 * It reports a state (not news), so it cannot be dismissed; it disappears by itself when
 * the location works again.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { bannerText } from '../domain/gateCopy';
import type { LocationBannerCause } from '../domain/gateState';

type Props = {
  cause: LocationBannerCause;
  onPress: () => void;
  /** Distance from the top of the host screen (below the safe area and any top bar). */
  top: number;
  style?: StyleProp<ViewStyle>;
};

export function LocationBanner({ cause, onPress, top, style }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [appear] = useState(() => new Animated.Value(0));
  const text = bannerText(cause);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        appear.setValue(1);
        return;
      }
      Animated.timing(appear, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
    return () => { cancelled = true; };
  }, [appear]);

  return (
    <Animated.View
      style={[
        styles.wrap,
        { top, opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] },
        style,
      ]}
      accessibilityLiveRegion="polite">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={text}>
        <View style={styles.icon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Ionicons name="locate-outline" size={26} color={colors.warning} />
          <View style={styles.slash} />
        </View>
        <Text style={styles.text}>{text}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.warning} />
      </Pressable>
    </Animated.View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 20 },
  banner: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  pressed: { opacity: 0.85 },
  icon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  slash: {
    position: 'absolute',
    width: 30,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.warning,
    transform: [{ rotate: '45deg' }],
  },
  text: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: fontWeight.medium },
});
