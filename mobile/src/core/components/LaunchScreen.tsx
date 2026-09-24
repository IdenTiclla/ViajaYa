import { StatusBar } from 'expo-status-bar';
import { Image, StyleSheet, View } from 'react-native';

// Brand navy, fixed in both themes: it continues the native splash (app.config.ts).
const BRAND_NAVY = '#16308C';

/** Branded screen shown while the stored session is restored at startup. */
export function LaunchScreen() {
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND_NAVY },
  art: { flex: 1, width: '100%' },
});
