/**
 * Bottom bar Stitch: el tab activo lleva un pill amarillo (`colors.accent`) con
 * icono + etiqueta en color oscuro; los inactivos van en gris, sin fondo, en
 * columna. Compartida por pasajero y conductor.
 *
 * Reemplaza al TabBar por defecto de React Navigation (que solo permite cambiar
 * el `tintColor`, no pintar un fondo por tab). Los iconos y títulos se declaran
 * en cada `Tabs.Screen` (`tabBarIcon` / `title`) y aquí se consumen tal cual.
 */
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

const ICON_SIZE = 22;

export function PillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  // Focus por key (no por índice) y filtra rutas ocultas: una tab se oculta
  // declarando `tabBarButton: () => null` (estándar RN); las visibles no la
  // definen. Ej.: el redirect "index" del conductor.
  const focusedKey = state.routes[state.index]?.key;
  const visibleRoutes = state.routes.filter(
    (route) => (descriptors[route.key].options as { tabBarButton?: unknown }).tabBarButton === undefined,
  );

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.xs }]}>
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

        const iconColor = isFocused ? colors.text : colors.textSecondary;
        const iconNode =
          typeof options.tabBarIcon === 'function'
            ? options.tabBarIcon({ focused: isFocused, color: iconColor, size: ICON_SIZE })
            : null;

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            android_ripple={{ color: 'transparent', borderless: false }}
            style={({ pressed }) => [
              styles.item,
              isFocused ? styles.itemFocused : styles.itemIdle,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={label}>
            {iconNode}
            <Text
              style={[styles.label, isFocused ? styles.labelFocused : styles.labelIdle]}
              numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
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
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  itemIdle: {
    flexDirection: 'column',
    gap: 2,
  },
  itemFocused: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
  },
  label: { fontSize: fontSize.xs },
  labelIdle: { color: colors.textSecondary },
  labelFocused: { color: colors.text, fontWeight: fontWeight.semibold },
  pressed: { opacity: 0.7 },
});
