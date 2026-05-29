import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

type Props = { title?: string; subtitle?: string };

/** Logo + marca TaxiGo usado en las pantallas de auth (diseño Stitch). */
export function BrandHeader({ title = 'TaxiGo', subtitle }: Props) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.logo}>
        <Ionicons name="car-sport" size={30} color={colors.textOnPrimary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing.xs },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.primary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
});
