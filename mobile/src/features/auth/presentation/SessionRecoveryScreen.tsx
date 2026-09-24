import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { spacing, useThemedStyles, type Theme } from '@/core/theme';
import { Button, FeedbackState } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

/** Allows retrying while keeping credentials, or explicitly going back to login. */
export function SessionRecoveryScreen() {
  const { styles } = useThemedStyles(createStyles);
  const error = useAuthStore((s) => s.startupError);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const signOut = useAuthStore((s) => s.signOut);
  const [leaving, setLeaving] = useState(false);
  const backToLogin = async () => {
    setLeaving(true);
    await signOut();
  };
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <FeedbackState
          title="No pudimos recuperar tu sesión"
          message={error ?? 'Revisa tu conexión y vuelve a intentar.'}
          icon="cloud-offline-outline"
          compact
        />
        <View style={styles.actions}>
          <Button
            title="Reintentar"
            variant="secondary"
            leadingIcon="refresh"
            disabled={leaving}
            onPress={() => void bootstrap()}
          />
          <Button
            title="Volver a iniciar sesión"
            loading={leaving}
            loadingLabel="Cerrando sesión…"
            onPress={() => void backToLogin()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  actions: {
    width: '100%', maxWidth: 400, alignSelf: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
});
