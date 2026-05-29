import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { Button } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

export default function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const initial = (user?.fullName?.trim().charAt(0) ?? 'V').toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{user?.fullName ?? 'Viajero'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        {user?.phone ? <Text style={styles.detail}>{user.phone}</Text> : null}

        <View style={styles.actions}>
          <Button title="Cerrar sesión" variant="secondary" onPress={() => void signOut()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', padding: spacing.lg, gap: spacing.xs },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  name: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  email: { fontSize: fontSize.md, color: colors.textSecondary },
  detail: { fontSize: fontSize.sm, color: colors.textSecondary },
  actions: { alignSelf: 'stretch', marginTop: spacing.xl },
});
