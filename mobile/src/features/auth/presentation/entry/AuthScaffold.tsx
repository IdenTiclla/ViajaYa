import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useRef } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
// Imported directly: the theme barrel must stay loadable by the Node unit tests (no expo-font).
import { useBrandFontStyle } from '@/core/theme/brandFont';
import { Button } from '@/shared/components';
import { AuthHero, SHEET_RADIUS } from './AuthHero';

type Props = { subtitle?: string; children: ReactNode };

/** Room kept above the focused field so its label (and the heading, when it fits) stay in view. */
const FOCUS_TOP_GAP = 96;
/** Waits for the keyboard padding to shrink the viewport; scrolling earlier clamps to the old range. */
const KEYBOARD_SETTLE_MS = 150;

/**
 * Scrolls the focused field above the keyboard. Android runs edge-to-edge (`edgeToEdgeEnabled`), so
 * `adjustResize` no longer shrinks the window and nothing else brings the field back into view.
 */
function useKeepFocusedInputVisible() {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput();
        const content = contentRef.current;
        if (!input || !content) return;
        input.measureLayout(content, (_x, y) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - FOCUS_TOP_GAP), animated: true });
        }, () => {});
      }, KEYBOARD_SETTLE_MS);
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, []);
  return { scrollRef, contentRef };
}

/** Frame for the entry screen: the splash route on brand navy, and the form on a sheet over it. */
export function AuthScaffold({ subtitle, children }: Props) {
  const { styles } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { scrollRef, contentRef } = useKeepFocusedInputVisible();
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Padding on both platforms: edge-to-edge Android does not resize the window for the keyboard. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" bounces={false} overScrollMode="never">
          <View ref={contentRef} collapsable={false} style={styles.flexGrow}>
            <AuthHero subtitle={subtitle} topInset={insets.top} />
            <View style={[styles.sheet, {
              paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg,
              paddingLeft: Math.max(insets.left, spacing.lg),
              paddingRight: Math.max(insets.right, spacing.lg),
            }]}>
              <View style={styles.card}>{children}</View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

type HeadingProps = { title: string; text?: string };

/** Section heading used by every auth step. */
export function AuthHeading({ title, text }: HeadingProps) {
  const { styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.title, brandFont]}>{title}</Text>
      {text && <Text style={styles.text}>{text}</Text>}
    </View>
  );
}

/** Inline notice (info or error) inside the card. */
export function AuthNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  const { styles } = useThemedStyles(createStyles);
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
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.loading}>
      {busy && <ActivityIndicator size="large" color={colors.primary} />}
      <Text style={styles.text}>{busy ? 'Preparamos tu acceso…' : 'No pudimos conectar con ViajaYa.'}</Text>
      {error && !busy && <AuthNotice tone="error">{error}</AuthNotice>}
      {!busy && <Button title="Reintentar conexión" onPress={onRetry} />}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  // The navy root also fills the overscroll area above the hero.
  root: { flex: 1, backgroundColor: colors.brand },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  content: { flexGrow: 1, backgroundColor: colors.background },
  sheet: { flexGrow: 1, marginTop: -SHEET_RADIUS, paddingTop: spacing.xl - spacing.xs,
    borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS, backgroundColor: colors.background },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing.md },
  heading: { gap: spacing.xs + 2 },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  text: { fontSize: fontSize.md, color: colors.textSecondary, lineHeight: 22 },
  notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  noticeError: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder },
  noticeText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },
  noticeTextError: { color: colors.danger },
  loading: { alignItems: 'stretch', gap: spacing.md, paddingVertical: spacing.md },
});
