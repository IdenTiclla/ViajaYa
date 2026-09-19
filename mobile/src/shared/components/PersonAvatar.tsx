import { Ionicons } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { fontWeight, radius, useEstilos, type Tema } from '@/core/theme';

/** Decorative identity mark; the adjacent full name remains the accessible label. */
export function PersonAvatar({ name, size = 44 }: { name?: string | null; size?: 40 | 44 | 48 }) {
  const { colors, styles } = useEstilos(createStyles);
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials = [words[0], words.length > 1 ? words.at(-1) : undefined]
    .filter(Boolean).map(word => Array.from(word!)[0]).join('').toUpperCase();
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: size, height: size }]}>
      {initials ? <Text allowFontScaling={false} style={[styles.initials, { fontSize: size * 0.36 }]}>
        {initials}
      </Text> : <Ionicons name="person-outline" size={size / 2} color={colors.primary} />}
    </View>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  root: { flexShrink: 0, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primarioSuave, borderWidth: 1, borderColor: colors.border },
  initials: { color: colors.primary, fontWeight: fontWeight.bold, letterSpacing: 0.5 },
});
