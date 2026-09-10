import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';
import { AccountSecurityPanel } from '@/features/auth/presentation/AccountSecurityPanel';
import { SelectorTema } from './SelectorTema';

export function PerfilPasajeroScreen() {
  const { styles } = useEstilos(crearEstilos);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const initial = (user?.fullName?.trim().charAt(0) ?? 'V').toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{user?.fullName ?? 'Viajero'}</Text>
        {user?.email && <Text style={styles.email}>{user.email}</Text>}
        {user?.phone ? <Text style={styles.detail}>{user.phone}</Text> : null}

        <SelectorTema />
        <AccountSecurityPanel />
        <View style={styles.actions}>
          <Button title="Cerrar sesión" variant="secondary" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, alignItems: 'center', padding: spacing.lg, gap: spacing.xs },
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
  name: { maxWidth: '100%', fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  email: { maxWidth: '100%', fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
  detail: { fontSize: fontSize.sm, color: colors.textSecondary },
  actions: { alignSelf: 'stretch', marginTop: spacing.xl },
});
