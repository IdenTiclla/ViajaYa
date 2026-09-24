import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, spacing, useThemedStyles, type Theme } from '@/core/theme';

type Props = {
  icon: IoniconsIconName;
  title: string;
  message?: string;
};

/** Placeholder screen for sections not implemented yet. */
export function Placeholder({ icon, title, message = 'Disponible próximamente.' }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Ionicons name={icon} size={48} color={colors.primary} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  message: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
});
