import { Ionicons } from '@react-native-vector-icons/ionicons';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemedStyles, type Theme } from '@/core/theme';

export type GateHeroVariant = 'primer' | 'denied' | 'blocked' | 'services-off' | 'unsupported';

/** Design heights (390 × 844 canvas); the safe-area top is added on top. */
export const HERO_DESIGN_HEIGHT: Record<GateHeroVariant, number> = {
  primer: 340,
  denied: 340,
  blocked: 250,
  'services-off': 340,
  unsupported: 340,
};
/** The hero gives room to the text on short screens, down to this height. */
export const HERO_MIN_HEIGHT = 150;
const FADE_STEPS = 8;
const FADE_HEIGHT = 60;

/** A road: the main-road casing with the street color on top. */
function Road({ style, thickness = 16 }: { style: ViewStyle; thickness?: number }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={[styles.road, style]}>
      <View style={[styles.street, { height: thickness - 7, borderRadius: thickness }]} />
    </View>
  );
}

function MapBackdrop({ muted, tall }: { muted: boolean; tall: boolean }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={[StyleSheet.absoluteFill, muted && styles.muted]} pointerEvents="none">
      {tall && <View style={styles.water} />}
      <View style={styles.parkTopRight} />
      <View style={styles.parkLeft} />
      <Road style={{ top: 70, left: '-10%', width: '120%', transform: [{ rotate: '4deg' }], height: 16 }} />
      <Road style={{ top: 200, left: '-10%', width: '120%', transform: [{ rotate: '-4deg' }], height: 16 }} />
      <View style={[styles.road, styles.vertical, { left: '27%', transform: [{ rotate: '6deg' }] }]}>
        <View style={styles.verticalStreet} />
      </View>
      <View style={[styles.road, styles.vertical, { left: '63%', transform: [{ rotate: '-3deg' }] }]}>
        <View style={styles.verticalStreet} />
      </View>
    </View>
  );
}

/** Pin built with views: a rotated rounded square is a teardrop pointing down. */
function Pin({ color, core, hole }: { color: string; core: string; hole: string }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.pinBox}>
      <View style={[styles.pinHead, { backgroundColor: color }]} />
      <View style={[styles.pinCore, { backgroundColor: core }]}>
        <View style={[styles.pinHole, { backgroundColor: hole }]} />
      </View>
    </View>
  );
}

type HeroProps = {
  variant: GateHeroVariant;
  /** Height without the safe-area top; defaults to the design height. */
  baseHeight?: number;
};

export function GateHero({ variant, baseHeight }: HeroProps) {
  const { colors, mode, styles } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const base = baseHeight ?? HERO_DESIGN_HEIGHT[variant];
  const height = base + insets.top;
  // The pin (92) and the disc (120) stay centered in the visible hero, which may be short.
  const pinTop = insets.top + Math.max(8, Math.round((base - 92) / 2) - 6);
  const discTop = insets.top + Math.max(8, Math.round((base - 120) / 2) - 6);
  const onDanger = mode === 'dark' ? colors.dangerSoft : '#FFFFFF';

  const showPin = variant === 'primer' || variant === 'denied' || variant === 'blocked';
  const badge = variant === 'denied' ? 'close' : variant === 'blocked' ? 'lock-closed' : null;

  return (
    <View
      style={[styles.hero, { height }]}
      accessibilityElementsHidden={variant === 'primer'}
      importantForAccessibility={variant === 'primer' ? 'no-hide-descendants' : 'auto'}>
      <MapBackdrop muted={variant !== 'primer'} tall={variant !== 'blocked'} />

      {variant === 'primer' && (
        <View style={[styles.ringsBox, { top: pinTop + 30 }]} pointerEvents="none">
          <View style={[styles.ring, { width: 236, height: 236, opacity: 0.07 }]} />
          <View style={[styles.ring, { width: 164, height: 164, opacity: 0.11 }]} />
          <View style={[styles.ring, { width: 96, height: 96, opacity: 0.16 }]} />
        </View>
      )}

      {showPin && (
        <View style={[styles.pinWrap, { top: pinTop }]}>
          <Pin
            color={variant === 'primer' ? colors.primary : colors.controlBorder}
            core={variant === 'primer' ? colors.accent : colors.background}
            hole={colors.primary}
          />
          {badge && (
            <View
              style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.background }]}
              accessible
              accessibilityRole="image"
              accessibilityLabel={variant === 'denied' ? 'Ubicación denegada' : 'Ubicación bloqueada'}>
              <Ionicons name={badge} size={22} color={onDanger} />
            </View>
          )}
        </View>
      )}

      {(variant === 'services-off' || variant === 'unsupported') && (
        <View style={[styles.pinWrap, { top: discTop }]}>
          <View
            style={[
              styles.disc,
              variant === 'services-off'
                ? { backgroundColor: colors.warningSoft, borderColor: colors.warning }
                : { backgroundColor: colors.surfaceMuted, borderColor: colors.controlBorder },
            ]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={variant === 'services-off' ? 'GPS apagado' : 'Sin ubicación en este dispositivo'}>
            <Ionicons
              name="locate-outline"
              size={64}
              color={variant === 'services-off' ? colors.warning : colors.controlBorder}
            />
            <View
              style={[
                styles.slash,
                { backgroundColor: variant === 'services-off' ? colors.warning : colors.controlBorder },
              ]}
            />
          </View>
        </View>
      )}

      <View style={styles.fade} pointerEvents="none">
        {Array.from({ length: FADE_STEPS }, (_, step) => (
          <View
            key={step}
            style={{
              height: FADE_HEIGHT / FADE_STEPS,
              backgroundColor: colors.background,
              opacity: (step + 1) / FADE_STEPS,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  hero: { backgroundColor: colors.mapLand, overflow: 'hidden' },
  muted: { opacity: 0.55 },
  water: {
    position: 'absolute', left: '-10%', right: '-10%', bottom: -40, height: 100,
    borderTopLeftRadius: 220, borderTopRightRadius: 140, backgroundColor: colors.mapWater,
  },
  parkTopRight: {
    position: 'absolute', right: '8%', top: 34, width: '28%', height: 80,
    borderRadius: 18, backgroundColor: colors.mapPark,
  },
  parkLeft: {
    position: 'absolute', left: '-3%', top: 122, width: '23%', height: 60,
    borderRadius: 14, backgroundColor: colors.mapPark,
  },
  road: { position: 'absolute', backgroundColor: colors.mapMainRoad, justifyContent: 'center', borderRadius: 16 },
  street: { backgroundColor: colors.mapStreet, marginHorizontal: 0 },
  vertical: { top: '-10%', height: '120%', width: 16 },
  verticalStreet: { alignSelf: 'center', width: 9, height: '100%', backgroundColor: colors.mapStreet, borderRadius: 9 },
  ringsBox: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', height: 0 },
  ring: { position: 'absolute', borderRadius: 200, backgroundColor: colors.primary },
  pinWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pinBox: { width: 72, height: 92, alignItems: 'center' },
  pinHead: {
    position: 'absolute', top: 12, width: 56, height: 56, borderRadius: 28,
    borderBottomRightRadius: 2, transform: [{ rotate: '45deg' }],
  },
  pinCore: {
    position: 'absolute', top: 27, width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  pinHole: { width: 10, height: 10, borderRadius: 5 },
  badge: {
    position: 'absolute', right: '50%', marginRight: -62, top: 52, width: 44, height: 44,
    borderRadius: 22, borderWidth: 4, alignItems: 'center', justifyContent: 'center',
  },
  disc: {
    width: 120, height: 120, borderRadius: 60, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  slash: { position: 'absolute', width: 100, height: 6, borderRadius: 3, transform: [{ rotate: '45deg' }] },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
