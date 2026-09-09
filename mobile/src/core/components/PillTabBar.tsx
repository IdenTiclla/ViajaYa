/**
 * Navegación compartida por pasajero y conductor. El icono activo conserva el
 * acento amarillo; todas las etiquetas tienen espacio y posición estables.
 *
 * Reemplaza al TabBar por defecto de React Navigation (que solo permite cambiar
 * el `tintColor`, no pintar un fondo por tab). Los iconos y títulos se declaran
 * en cada `Tabs.Screen` (`tabBarIcon` / `title`) y aquí se consumen tal cual.
 */
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { controles, fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';

const ICON_SIZE = 22;

export function PillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, styles, estiloFoco } = useEstilos(crearEstilos);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [enfocada, setEnfocada] = useState<string | null>(null);
  const dosFilas = fontScale > 1.3;

  // Focus por key (no por índice) y filtra rutas ocultas: una tab se oculta
  // declarando `tabBarButton: () => null` (estándar RN); las visibles no la
  // definen. Ej.: el redirect "index" del conductor.
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

        const iconColor = isFocused ? colors.textoSobreAcento : colors.textSecondary;
        const iconNode =
          typeof options.tabBarIcon === 'function'
            ? options.tabBarIcon({ focused: isFocused, color: iconColor, size: ICON_SIZE })
            : null;

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            onFocus={() => setEnfocada(route.key)}
            onBlur={() => setEnfocada(null)}
            android_ripple={{ color: 'transparent', borderless: false }}
            style={({ pressed }) => [
              styles.item,
              dosFilas && styles.itemGrande,
              pressed && styles.pressed,
              enfocada === route.key && estiloFoco,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            aria-selected={isFocused}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}>
            <View style={[styles.icono, isFocused && styles.iconoActivo]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
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
    minHeight: controles.altoMinimo,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    flexDirection: 'column',
    gap: 2,
  },
  itemGrande: { flexBasis: '45%' },
  icono: { minWidth: 48, paddingVertical: 2, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconoActivo: { backgroundColor: colors.accent },
  label: { fontSize: fontSize.xs, textAlign: 'center', maxWidth: '100%' },
  labelIdle: { color: colors.textSecondary },
  labelFocused: { color: colors.text, fontWeight: fontWeight.semibold },
  pressed: { opacity: 0.92 },
});
