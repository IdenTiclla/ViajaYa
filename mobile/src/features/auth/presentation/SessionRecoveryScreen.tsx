import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';

import { colors } from '@/core/theme';
import { FeedbackState } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

/** Permite recuperar el arranque sin borrar credenciales por un fallo transitorio. */
export function SessionRecoveryScreen() {
  const error = useAuthStore((s) => s.startupError);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  return (
    <SafeAreaView style={styles.root}>
      <FeedbackState
        title="No pudimos recuperar tu sesión"
        message={error ?? 'Revisa tu conexión y vuelve a intentar.'}
        icon="cloud-offline-outline"
        actionLabel="Reintentar"
        onAction={() => void bootstrap()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background } });
