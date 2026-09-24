import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fontSize, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { Button } from '@/shared/components';
import { AuthNotice } from './AuthScaffold';

type Props = { busy: boolean; error: string | null; onRetry: () => void; onBack: () => void };

/** Last step: the session is being accepted; the root gate navigates away on success. */
export function SessionEntering({ busy, error, onRetry, onBack }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.wrapper}>
      {busy && <ActivityIndicator size="large" color={colors.primary} />}
      <Text style={styles.text}>{busy ? 'Entrando a tu cuenta…' : 'No pudimos completar el acceso.'}</Text>
      {error && !busy && <AuthNotice tone="error">{error}</AuthNotice>}
      {!busy && <Button title="Reintentar acceso" onPress={onRetry} />}
      {!busy && <Button title="Volver al inicio" variant="secondary" onPress={onBack} />}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrapper: { gap: spacing.md, paddingVertical: spacing.md },
  text: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
});
