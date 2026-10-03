/**
 * Price pin of an open request on the driver's map: a pill with the amount
 * above a short stem whose tip is the pickup coordinate. White for the other
 * requests, green once the driver offered (with their amount). The selected
 * request uses the route's A pin instead. Drawn with native views (no icon
 * font) so the Android bitmap stays stable.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';

import { fontSize, fontWeight, radius, useThemedStyles, type Theme } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';
import { formatBolivianos } from '@/features/rides/domain/money';
import { scheduleMarkerRedraw } from '@/features/rides/presentation/routeTooltipLayout';

const LATE_REDRAW_MS = 400;

type Props = {
  coordinate: Coordinates;
  price: number;
  offered?: boolean;
  /** Spoken name of the request (passenger and pickup). */
  label: string;
  zIndex?: number;
  onPress?: () => void;
};

export function RequestPriceMarker({ coordinate, price, offered = false, label, zIndex = 6, onPress }: Props) {
  const { styles, mode } = useThemedStyles(createStyles);
  const marker = useRef<MapMarker>(null);
  const text = `${offered ? '✓ ' : ''}Bs ${formatBolivianos(price)}`;
  const redrawKey = `${text}|${offered}|${mode}`;
  useEffect(() => scheduleMarkerRedraw(() => marker.current?.redraw()), [redrawKey]);
  // Android may capture the bitmap before the text lays out; a late pass repairs it.
  useEffect(() => {
    const timer = setTimeout(() => marker.current?.redraw(), LATE_REDRAW_MS);
    return () => clearTimeout(timer);
  }, [redrawKey]);

  return (
    <Marker
      ref={marker}
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 1 }}
      zIndex={zIndex}
      accessibilityLabel={`${label}, ${offered ? 'tu oferta ' : ''}Bs ${formatBolivianos(price)}`}
      onPress={onPress}>
      <View collapsable={false} style={styles.wrap}>
        <View style={[styles.pill, offered && styles.pillOffered]}>
          <Text allowFontScaling={false} style={[styles.text, offered && styles.textOffered]}>{text}</Text>
        </View>
        <View style={[styles.stem, offered && styles.stemOffered]} />
        <View style={[styles.dot, offered && styles.stemOffered]} />
      </View>
    </Marker>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 2 },
  pill: {
    minHeight: 28,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  // Fixed green: white text stays readable in both themes.
  pillOffered: { backgroundColor: '#167347', borderColor: '#FFFFFF' },
  text: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  textOffered: { color: '#FFFFFF' },
  stem: { width: 2, height: 9, backgroundColor: colors.textSecondary },
  stemOffered: { backgroundColor: '#167347' },
  dot: { width: 6, height: 6, marginTop: -2, borderRadius: 3, backgroundColor: colors.textSecondary },
});
