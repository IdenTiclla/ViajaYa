import { type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button } from '@/shared/components';
import { BrandHeader } from '../BrandHeader';

type Props = { subtitle?: string; children: ReactNode; footer?: ReactNode };

/** Shared frame for the auth screens: brand on top, form card in the middle, links below. */
export function AuthScaffold({ subtitle, children, footer }: Props) {
  const { styles } = useEstilos(createStyles);
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <BrandHeader subtitle={subtitle} />
          <View style={styles.card}>{children}</View>
          {footer && <View style={styles.footer}>{footer}</View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type HeadingProps = { title: string; text?: string };

/** Section heading used by every auth step. */
export function AuthHeading({ title, text }: HeadingProps) {
  const { styles } = useEstilos(createStyles);
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {text && <Text style={styles.text}>{text}</Text>}
    </View>
  );
}

/** Inline notice (info or error) inside the card. */
export function AuthNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  const { styles } = useEstilos(createStyles);
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[styles.notice, tone === 'error' && styles.noticeError]}>
      <Text style={[styles.noticeText, tone === 'error' && styles.noticeTextError]}>{children}</Text>
    </View>
  );
}

type LoadingProps = { busy: boolean; error: string | null; onRetry: () => void };

/** First paint while capabilities load; shows a retry only after a failure. */
export function AuthLoading({ busy, error, onRetry }: LoadingProps) {
  const { colors, styles } = useEstilos(createStyles);
  return (
    <View style={styles.loading}>
      {busy && <ActivityIndicator size="large" color={colors.primary} />}
      <Text style={styles.text}>{busy ? 'Preparamos tu acceso…' : 'No pudimos conectar con ViajaYa.'}</Text>
      {error && !busy && <AuthNotice tone="error">{error}</AuthNotice>}
      {!busy && <Button title="Reintentar conexión" onPress={onRetry} />}
    </View>
  );
}

const createStyles = ({ colors, modo }: Tema) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl,
    gap: spacing.xl, justifyContent: 'center' },
  card: {
    width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    ...(modo === 'light' ? { shadowColor: '#0F2266', shadowOpacity: 0.08, shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 }, elevation: 3 } : {}),
  },
  footer: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing.xs, alignItems: 'center' },
  heading: { gap: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  text: { fontSize: fontSize.md, color: colors.textSecondary, lineHeight: 22 },
  notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarioSuave },
  noticeError: { backgroundColor: colors.peligroSuave, borderWidth: 1, borderColor: colors.bordePeligro },
  noticeText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },
  noticeTextError: { color: colors.danger },
  loading: { alignItems: 'stretch', gap: spacing.md, paddingVertical: spacing.md },
});
