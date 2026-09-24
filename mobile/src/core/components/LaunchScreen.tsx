import { StatusBar } from 'expo-status-bar';
import { Image, StyleSheet, View } from 'react-native';

import { useThemedStyles, type Theme } from '@/core/theme';

/** Branded screen shown while the stored session is restored at startup. */
export function LaunchScreen() {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Image
        source={require('@/assets/images/launch-screen.png')}
        style={styles.art}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="ViajaYa. Taxi o moto, tú pones el precio."
      />
    </View>
  );
}

// Brand navy (fixed in both themes) continues the native splash from app.config.ts.
const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },
  art: { flex: 1, width: '100%' },
});
