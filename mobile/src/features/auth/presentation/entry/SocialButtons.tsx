import { StyleSheet, Text, View } from 'react-native';

import { fontSize, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { Button } from '@/shared/components';
import type { SocialProvider } from '../../domain/phoneAccess';

type ProviderControl = { loading: boolean; disabled: boolean; onPress: () => void };
type Props = { providers: SocialProvider[]; google: ProviderControl; facebook: ProviderControl };

/** "o continúa con" divider + provider buttons. Renders nothing when the server offers none. */
export function SocialButtons({ providers, google, facebook }: Props) {
  const { styles } = useThemedStyles(createStyles);
  if (providers.length === 0) return null;
  return (
    <View style={styles.wrapper}>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>o continúa con</Text>
        <View style={styles.line} />
      </View>
      {providers.includes('google') && (
        <Button title="Continuar con Google" variant="secondary" leadingIcon="logo-google"
          loading={google.loading} disabled={google.disabled} onPress={google.onPress} />
      )}
      {providers.includes('facebook') && (
        <Button title="Continuar con Facebook" variant="secondary" leadingIcon="logo-facebook"
          loading={facebook.loading} disabled={facebook.disabled} onPress={facebook.onPress} />
      )}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrapper: { gap: spacing.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
