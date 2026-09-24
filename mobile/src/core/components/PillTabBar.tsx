/**
 * Navigation shared by passenger and driver. The active icon keeps the
 * yellow accent; every label has a stable space and position.
 *
 * Replaces React Navigation's default TabBar (which only allows changing
 * the `tintColor`, not painting a background per tab). Icons and titles are declared
 * in each `Tabs.Screen` (`tabBarIcon` / `title`) and consumed here as is.
 */
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { controls, fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

const ICON_SIZE = 22;

export function PillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, styles, focusStyle } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState<string | null>(null);
  const twoRows = fontScale > 1.3;

  // Focus by key (not by index) and filter hidden routes: a tab is hidden
  // by declaring `tabBarButton: () => null` (RN standard); visible ones do not
  // define it. E.g.: the driver's "index" redirect.
  const focusedKey = state.routes[state.index]?.key;
  const visibleRoutes = state.routes.filter(
    (route) => (descriptors[route.key].options as { tabBarButton?: unknown }).tabBarButton === undefined,
  );

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.xs }]} accessibilityRole="tablist">
      {visibleRoutes.map((route) => {
        const { options } = descriptors[route.key];
        const isFocused = route.key === focusedKey;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        const label =
          typeof options.title === 'string' && options.title.length
            ? options.title
            : route.name;

        const iconColor = isFocused ? colors.textOnAccent : colors.textSecondary;
        const iconNode =
          typeof options.tabBarIcon === 'function'
            ? options.tabBarIcon({ focused: isFocused, color: iconColor, size: ICON_SIZE })
            : null;

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            onFocus={() => setFocused(route.key)}
            onBlur={() => setFocused(null)}
            android_ripple={{ color: 'transparent', borderless: false }}
            style={({ pressed }) => [
              styles.item,
              twoRows && styles.largeItem,
              pressed && styles.pressed,
              focused === route.key && focusStyle,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            aria-selected={isFocused}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}>
            <View style={[styles.icon, isFocused && styles.activeIcon]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {iconNode}
            </View>
            <Text
              style={[styles.label, isFocused ? styles.labelFocused : styles.labelIdle]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    justifyContent: 'space-around',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: controls.minHeight,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    flexDirection: 'column',
    gap: 2,
  },
  largeItem: { flexBasis: '45%' },
  icon: { minWidth: 48, paddingVertical: 2, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  activeIcon: { backgroundColor: colors.accent },
  label: { fontSize: fontSize.xs, textAlign: 'center', maxWidth: '100%' },
  labelIdle: { color: colors.textSecondary },
  labelFocused: { color: colors.text, fontWeight: fontWeight.semibold },
  pressed: { opacity: 0.92 },
});
