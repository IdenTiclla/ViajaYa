/**
 * "Viaje ya no disponible" (conductor) — diseño Stitch "Estado del Viaje".
 *
 * Se muestra cuando una solicitud que el conductor estaba mirando/esperando deja
 * de estar disponible: otro conductor la tomó, el pasajero canceló, o expiró su
 * ventana de negociación. Ícono con ondas, mensaje tranquilizador, tarjeta con la
 * última oferta y el trayecto, y un botón para volver a las solicitudes.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

export function RideUnavailableScreen({
  price,
  originName,
  destName,
  onBack,
  priceLabel = 'Última oferta',
  title = 'Viaje ya no disponible',
  hint = 'Este servicio fue tomado por otro conductor o cancelado por el pasajero. ¡No te preocupes! Sigue buscando oportunidades en el mapa.',
  badge,
}: {
  price: number | null;
  originName: string | null;
  destName: string | null;
  onBack: () => void;
  priceLabel?: string;
  title?: string;
  hint?: string;
  /** Etiqueta opcional de la tarjeta (p. ej. "Expirado", "Cancelado"). Si no se
   * pasa, no se muestra (antes estaba hardcodeada como "Expirado"). */
  badge?: string;
}) {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <TouchableOpacity
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Estado del viaje</Text>
      </SafeAreaView>

      <View style={styles.body}>
        <RippleIcon />

        <View style={styles.textWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardLabel}>{priceLabel}</Text>
              <Text style={styles.price}>{price != null ? `Bs ${price.toFixed(2)}` : '—'}</Text>
            </View>
            {badge ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.timeline}>
            <View style={styles.timelineLine} />
            <View style={styles.stop}>
              <View style={[styles.dot, styles.dotOrigin]}>
                <View style={[styles.dotInner, { backgroundColor: colors.primary }]} />
              </View>
              <View style={styles.stopText}>
                <Text style={styles.stopLabel}>Origen</Text>
                <Text style={styles.stopValue} numberOfLines={1}>
                  {originName ?? '—'}
                </Text>
              </View>
            </View>
            <View style={styles.stop}>
              <View style={[styles.dot, styles.dotDest]}>
                <View style={[styles.dotInner, { backgroundColor: colors.danger }]} />
              </View>
              <View style={styles.stopText}>
                <Text style={styles.stopLabel}>Destino</Text>
                <Text style={styles.stopValue} numberOfLines={1}>
                  {destName ?? '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <TouchableOpacity
          style={styles.cta}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Volver a solicitudes">
          <Ionicons name="compass" size={20} color={colors.textOnPrimary} />
          <Text style={styles.ctaText}>Volver a solicitudes</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

/** Ícono central con ondas expandiéndose (ripple), en bucle infinito. */
function RippleIcon() {
  const [wave] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [wave]);

  const rippleStyle = {
    transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.6] }) }],
    opacity: wave.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  };

  return (
    <View style={styles.rippleWrap}>
      <Animated.View style={[styles.ripple, rippleStyle]} />
      <View style={styles.rippleCore}>
        <Ionicons name="time-outline" size={56} color={colors.accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.primary },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.lg },

  rippleWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  ripple: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  rippleCore: {
    width: 112,
    height: 112,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  textWrap: { alignItems: 'center', gap: spacing.sm },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  hint: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', maxWidth: 300, lineHeight: 22 },

  card: {
    alignSelf: 'stretch',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  price: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  timeline: { gap: spacing.md },
  timelineLine: {
    position: 'absolute',
    left: 11,
    top: 24,
    bottom: 24,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    borderStyle: 'dashed',
  },
  stop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOrigin: { borderColor: colors.primary },
  dotDest: { borderColor: colors.danger },
  dotInner: { width: 8, height: 8, borderRadius: radius.pill },
  stopText: { flex: 1 },
  stopLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  stopValue: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  ctaText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
});
