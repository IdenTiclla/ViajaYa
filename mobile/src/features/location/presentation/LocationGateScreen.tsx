/**
 * The intercept screen: one layout, four causes (plus the driver-only «unsupported»).
 * Each variant names the cause and offers the single action that fixes it.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBrandFontStyle } from '@/core/theme/brandFont';
import { Button } from '@/shared/components/Button';
import {
  gateContent,
  UNSUPPORTED_CONTENT,
  type GateBenefit,
  type GateContent,
} from '../domain/gateCopy';
import type { BlockingGateKind, LocationRole } from '../domain/gateState';
import { GateHero, HERO_DESIGN_HEIGHT, HERO_MIN_HEIGHT } from './GateHero';
import { GateSteps } from './GateSteps';
import { RichLine } from './RichLine';

export type GateScreenKind = BlockingGateKind | 'unsupported';

type Props = {
  kind: GateScreenKind;
  role: LocationRole;
  /** A system dialog or a settings round trip is in flight. */
  busy?: boolean;
  onPrimary: () => void;
  /** «Ahora no»: only for the passenger. */
  onSecondary?: () => void;
};

const BENEFIT_ICON: Record<GateBenefit['icon'], IoniconsIconName> = {
  locate: 'locate-outline',
  car: 'car-outline',
  lock: 'lock-closed-outline',
};

const CTA_ICON: Record<GateScreenKind, IoniconsIconName> = {
  primer: 'navigate',
  denied: 'navigate',
  blocked: 'settings-outline',
  'services-off': 'navigate',
  unsupported: 'arrow-back',
};

function contentFor(kind: GateScreenKind, role: LocationRole): GateContent {
  if (kind === 'unsupported') {
    return { title: UNSUPPORTED_CONTENT.title, body: UNSUPPORTED_CONTENT.body, cta: UNSUPPORTED_CONTENT.cta };
  }
  return gateContent(kind, role, Platform.OS === 'ios' ? 'ios' : 'android');
}

export function LocationGateScreen({ kind, role, busy = false, onPrimary, onSecondary }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const brandFont = useBrandFontStyle();
  const content = contentFor(kind, role);
  const titleRef = useRef<Text>(null);

  // On short screens the hero shrinks so the button and «Ahora no» stay in view: it gets
  // whatever the measured text and actions leave free, between its minimum and its design height.
  const [viewportHeight, setViewportHeight] = useState(0);
  const [topHeight, setTopHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const designBase = HERO_DESIGN_HEIGHT[kind];
  const contentChrome = spacing.sm + spacing.lg + spacing.lg + Math.min(insets.bottom, spacing.md);
  const measured = viewportHeight > 0 && topHeight > 0 && footerHeight > 0;
  const heroBase = measured
    ? Math.round(Math.min(
      designBase,
      Math.max(HERO_MIN_HEIGHT, viewportHeight - insets.top - topHeight - footerHeight - contentChrome),
    ))
    : designBase;
  const track = (setter: (height: number) => void) => (event: LayoutChangeEvent) => {
    setter(Math.round(event.nativeEvent.layout.height));
  };

  // The screen reader starts on the title, the first thing that explains the screen.
  useEffect(() => {
    const timer = setTimeout(() => {
      const handle = findNodeHandle(titleRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 300);
    return () => clearTimeout(timer);
  }, [kind]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      bounces={false}
      onLayout={track(setViewportHeight)}
      showsVerticalScrollIndicator={false}>
      <GateHero variant={kind} baseHeight={heroBase} />

      <View style={[styles.content, { paddingBottom: spacing.lg + Math.min(insets.bottom, spacing.md) }]}>
        <View onLayout={track(setTopHeight)}>
        <Text ref={titleRef} style={[styles.title, brandFont]} accessibilityRole="header">
          {content.title}
        </Text>
        <Text style={styles.body}>{content.body}</Text>

        {content.benefits && (
          <View style={styles.benefits}>
            {content.benefits.map((benefit) => (
              <View key={benefit.text} style={styles.benefit}>
                <View style={styles.benefitTile}>
                  <Ionicons name={BENEFIT_ICON[benefit.icon]} size={22} color={colors.primary} />
                </View>
                <Text style={styles.benefitText}>{benefit.text}</Text>
              </View>
            ))}
          </View>
        )}

        {content.steps && (
          <View style={styles.blockGap}>
            <GateSteps steps={content.steps} />
          </View>
        )}

        {content.card && (
          <View
            style={[
              styles.card,
              content.card.tone === 'danger' ? styles.cardDanger : styles.cardWarning,
              styles.blockGap,
            ]}>
            <Ionicons
              name={content.card.tone === 'danger' ? 'alert-circle-outline' : 'warning-outline'}
              size={22}
              color={content.card.tone === 'danger' ? colors.danger : colors.warning}
              style={styles.cardIcon}
            />
            <RichLine parts={content.card.text} style={styles.cardText} />
          </View>
        )}

        </View>

        <View style={styles.spacer} />

        <View onLayout={track(setFooterHeight)}>
        {content.caption && (
          <Text style={styles.caption} accessibilityLiveRegion="polite">{content.caption}</Text>
        )}
        <Button
          title={content.cta}
          leadingIcon={CTA_ICON[kind]}
          loading={busy}
          loadingLabel={content.cta}
          onPress={onPrimary}
          style={styles.cta}
        />
        {content.secondary && onSecondary && (
          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            onPress={onSecondary}
            accessibilityRole="button"
            accessibilityLabel={content.secondary}>
            <Text style={styles.secondaryText}>{content.secondary}</Text>
          </Pressable>
        )}
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1 },
  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  title: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: fontWeight.bold,
  },
  body: {
    marginTop: spacing.sm + 2,
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 24,
  },
  benefits: { marginTop: 22, gap: 14 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  benefitTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1, color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  blockGap: { marginTop: 22 },
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'flex-start',
  },
  cardDanger: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder },
  cardWarning: { backgroundColor: colors.warningSoft },
  cardIcon: { marginTop: 1 },
  cardText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
  spacer: { flex: 1, minHeight: spacing.lg },
  caption: {
    marginBottom: spacing.sm + spacing.xs,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  cta: { minHeight: 56 },
  secondary: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryPressed: { backgroundColor: colors.primarySoft },
  secondaryText: { color: colors.primary, fontSize: fontSize.md, fontWeight: fontWeight.medium },
});
