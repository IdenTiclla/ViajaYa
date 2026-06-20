/**
 * Buscando ofertas (pasajero) — diseño Stitch "Searching for Offers".
 *
 * Mapa de fondo con el trayecto y un pulso sobre el origen; arriba el resumen
 * origen→destino; abajo una tarjeta con el estado de búsqueda, los controles
 * para **aumentar la oferta** (recibe ofertas más rápido) y las acciones de
 * modificar/cancelar la solicitud. Se muestra mientras el viaje sigue
 * `searching` y aún no llegan ofertas; al recibir la primera, `OffersScreen`
 * pasa a la lista.
 *
 * La búsqueda no caduca: se sale solo al **modificar** (crea otra solicitud) o
 * **cancelar**. Aumentar la oferta solo sube el monto (nunca lo baja) y lo
 * anuncia a los conductores en vivo.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import type { Place } from '@/features/booking/domain/types';
import {
  useCancelRide,
  usePauseForEdit,
  useUpdateRideFare,
} from '@/features/rides/application/useRideMutations';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { ConfirmDialog } from '@/shared/components';

/** Incrementos rápidos de la oferta (en Bs) con su etiqueta de prioridad. */
const QUICK_INCREMENTS = [
  { delta: 2, hint: 'Sugerido' },
  { delta: 5, hint: 'Rápido' },
  { delta: 10, hint: 'Prioridad' },
] as const;

export function SearchingDriversScreen({
  rideId,
  origin,
  destination,
  currentFare,
}: {
  rideId: string | null;
  origin: Place | null;
  destination: Place | null;
  /** Oferta vigente del viaje (en vivo); base para los incrementos. */
  currentFare: number | null;
}) {
  const router = useRouter();
  const cancelRide = useCancelRide();
  const updateFare = useUpdateRideFare();
  const pauseForEdit = usePauseForEdit();

  const [customAmount, setCustomAmount] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  // La búsqueda no caduca: se sale al modificar (pausa y edita) o cancelar.
  const onModify = () => {
    if (pauseForEdit.isPending) return;
    if (!rideId) {
      router.replace('/(app)/booking/configure');
      return;
    }
    // Pausa la solicitud (la oculta del pool) y abre la edición sin cancelar.
    pauseForEdit.mutate(rideId, {
      onSuccess: () =>
        router.replace({ pathname: '/(app)/booking/configure', params: { rideId } }),
    });
  };

  const onCancel = () => {
    setConfirmCancel(false);
    if (cancelRide.isPending) return;
    useBookingStore.getState().resetTrip();
    if (!rideId) {
      router.replace('/(app)/(tabs)');
      return;
    }
    cancelRide.mutate(rideId, {
      onSuccess: () => router.replace('/(app)/(tabs)'),
    });
  };

  // Aumentar la oferta = oferta actual + incremento (redondeado a 2 decimales).
  const applyIncrease = (delta: number) => {
    if (!rideId || updateFare.isPending || delta <= 0) return;
    const base = currentFare ?? 0;
    const next = Math.round((base + delta) * 100) / 100;
    updateFare.mutate({ rideId, fare: next });
  };

  const onApplyCustom = () => {
    const delta = Number.parseFloat(customAmount.replace(',', '.'));
    if (!Number.isFinite(delta) || delta <= 0) return;
    applyIncrease(delta);
    setCustomAmount('');
  };

  return (
    <View style={styles.root}>
      {origin && destination ? (
        <TripRouteMap origin={origin} destination={destination} bottomPadding={440} />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <View style={styles.scrim} pointerEvents="box-none">
        <SafeAreaView edges={['top']} style={styles.topArea} pointerEvents="box-none">
          <View style={styles.summary}>
            <View style={styles.summaryTrack}>
              <View style={styles.dotOrigin} />
              <View style={styles.trackLine} />
              <View style={styles.dotDest} />
            </View>
            <View style={styles.summaryText}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryPlace} numberOfLines={1}>
                  {origin?.name ?? 'Tu ubicación'}
                </Text>
                <View style={[styles.badge, styles.badgeOrigin]}>
                  <Text style={[styles.badgeText, styles.badgeTextOrigin]}>Inicio</Text>
                </View>
              </View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryPlace, styles.summaryDest]} numberOfLines={1}>
                  {destination?.name ?? 'Destino'}
                </Text>
                <View style={[styles.badge, styles.badgeDest]}>
                  <Text style={[styles.badgeText, styles.badgeTextDest]}>Destino</Text>
                </View>
              </View>
            </View>
          </View>
        </SafeAreaView>

        <View style={styles.center} pointerEvents="none">
          <PulseLoader />
        </View>

        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />

          {/* Estado de búsqueda */}
          <View style={styles.statusRow}>
            <View style={styles.statusText}>
              <View style={styles.statusTitleRow}>
                <View style={styles.liveDot} />
                <Text style={styles.statusTitle}>Buscando ofertas…</Text>
              </View>
              <Text style={styles.statusSubtitle}>Conectando con conductores cercanos</Text>
            </View>
            <View style={styles.syncBadge}>
              <Ionicons name="sync" size={18} color={colors.primary} />
            </View>
          </View>

          {/* Aumentar oferta */}
          <View style={styles.bidHeader}>
            <Text style={styles.bidTitle}>Aumentar oferta</Text>
            <Text style={styles.bidHint}>Recibe ofertas más rápido</Text>
          </View>
          {currentFare != null && (
            <Text style={styles.currentFare}>Tu oferta actual: Bs {currentFare.toFixed(2)}</Text>
          )}

          <View style={styles.bidGrid}>
            {QUICK_INCREMENTS.map((inc, i) => (
              <TouchableOpacity
                key={inc.delta}
                style={[
                  styles.bidBtn,
                  i === 0 && styles.bidBtnSuggested,
                  updateFare.isPending && styles.disabled,
                ]}
                onPress={() => applyIncrease(inc.delta)}
                disabled={updateFare.isPending}
                accessibilityRole="button"
                accessibilityLabel={`Aumentar oferta en ${inc.delta} bolivianos`}>
                <Text style={styles.bidAmount}>+Bs {inc.delta}</Text>
                <Text style={styles.bidHintSmall}>{inc.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.customRow}>
            <Text style={styles.customPrefix}>+Bs</Text>
            <TextInput
              style={styles.customInput}
              value={customAmount}
              onChangeText={setCustomAmount}
              placeholder="Monto personalizado"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={onApplyCustom}
            />
            <TouchableOpacity
              style={[styles.applyBtn, (updateFare.isPending || !customAmount) && styles.disabled]}
              onPress={onApplyCustom}
              disabled={updateFare.isPending || !customAmount}
              accessibilityRole="button"
              accessibilityLabel="Aplicar monto personalizado">
              <Text style={styles.applyText}>Aplicar</Text>
            </TouchableOpacity>
          </View>

          {updateFare.isError && (
            <Text style={styles.error}>{getApiErrorMessage(updateFare.error)}</Text>
          )}

          {/* Barra de progreso */}
          <ProgressBar />
          <Text style={styles.progressLabel}>Esperando ofertas de conductores</Text>

          {/* Acciones */}
          {cancelRide.isError && (
            <Text style={styles.error}>{getApiErrorMessage(cancelRide.error)}</Text>
          )}
          {pauseForEdit.isError && (
            <Text style={styles.error}>{getApiErrorMessage(pauseForEdit.error)}</Text>
          )}
          <TouchableOpacity
            style={[styles.modify, pauseForEdit.isPending && styles.disabled]}
            onPress={onModify}
            disabled={pauseForEdit.isPending}
            accessibilityRole="button"
            accessibilityLabel="Modificar solicitud">
            <Ionicons name="create-outline" size={20} color={colors.primary} />
            <Text style={styles.modifyText}>Modificar solicitud</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cancel, cancelRide.isPending && styles.disabled]}
            onPress={() => setConfirmCancel(true)}
            disabled={cancelRide.isPending}
            accessibilityRole="button"
            accessibilityLabel="Cancelar solicitud">
            <Ionicons name="close" size={18} color={colors.danger} />
            <Text style={styles.cancelText}>
              {cancelRide.isPending ? 'Cancelando…' : 'Cancelar solicitud'}
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>

      <ConfirmDialog
        visible={confirmCancel}
        icon="warning"
        destructive
        title="¿Cancelar solicitud?"
        message="Si cancelas ahora, podrías perder las ofertas de conductores cercanos que ya están evaluando tu viaje."
        confirmText="Sí, cancelar"
        cancelText="No, seguir esperando"
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </View>
  );
}

/** Loader circular con dos anillos que se expanden (pulso) y un ícono central
 * que late, en bucle infinito mientras se buscan conductores. */
function PulseLoader() {
  const [ring1] = useState(() => new Animated.Value(0));
  const [ring2] = useState(() => new Animated.Value(0));
  const [core] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // Todas las animaciones usan el driver nativo. Evitamos `Animated.delay`
    // dentro de la secuencia (es no-nativo y, al mezclarse con timings nativos,
    // rompe el `loop` tras una pasada); el desfase del 2º anillo va por setTimeout.
    const ringLoop = (value: Animated.Value) =>
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: 2200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      );

    const a = ringLoop(ring1);
    const b = ringLoop(ring2);
    a.start();
    const stagger = setTimeout(() => b.start(), 1100);

    const coreLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(core, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(core, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    coreLoop.start();

    return () => {
      clearTimeout(stagger);
      a.stop();
      b.stop();
      coreLoop.stop();
    };
  }, [ring1, ring2, core]);

  const ringStyle = (value: Animated.Value) => ({
    transform: [
      {
        scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.8] }),
      },
    ],
    opacity: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.25, 0] }),
  });

  const coreStyle = {
    transform: [{ scale: core.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
  };

  return (
    <View style={styles.loader}>
      <Animated.View style={[styles.ring, ringStyle(ring1)]} />
      <Animated.View style={[styles.ring, ringStyle(ring2)]} />
      <Animated.View style={[styles.loaderCore, coreStyle]}>
        <Ionicons name="search" size={26} color={colors.textOnPrimary} />
      </Animated.View>
    </View>
  );
}

/** Barra de progreso indeterminada: un segmento que recorre la pista en bucle. */
function ProgressBar() {
  const [progress] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 0.4, width],
  });

  return (
    <View style={styles.progressTrack} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.progressBar, { transform: [{ translateX }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceMuted },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  topArea: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  summaryTrack: { alignItems: 'center', gap: 2 },
  dotOrigin: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primary },
  trackLine: { width: 2, height: 16, backgroundColor: colors.border },
  dotDest: { width: 10, height: 10, backgroundColor: colors.danger, transform: [{ rotate: '45deg' }] },
  summaryText: { flex: 1, gap: spacing.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  summaryPlace: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  summaryDest: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  badgeOrigin: { backgroundColor: colors.surfaceMuted },
  badgeDest: { backgroundColor: '#FDECEA' },
  badgeText: { fontSize: 10, fontWeight: fontWeight.bold, textTransform: 'uppercase' },
  badgeTextOrigin: { color: colors.primary },
  badgeTextDest: { color: colors.danger },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  loader: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.primary },
  loaderCore: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },

  sheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { flex: 1 },
  statusTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  liveDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  statusTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  statusSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  syncBadge: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  bidHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  bidTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  bidHint: { fontSize: fontSize.xs, color: colors.textSecondary, fontStyle: 'italic' },
  currentFare: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: -spacing.xs },

  bidGrid: { flexDirection: 'row', gap: spacing.sm },
  bidBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bidBtnSuggested: { backgroundColor: '#FFF7D6', borderColor: colors.accent },
  bidAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  bidHintSmall: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },

  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customPrefix: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  customInput: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  applyBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  applyText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textOnPrimary },

  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  progressBar: { width: '40%', height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  progressLabel: {
    fontSize: 10,
    color: colors.placeholder,
    textAlign: 'center',
    textTransform: 'uppercase',
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },

  modify: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    marginTop: spacing.xs,
  },
  modifyText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.primary },
  cancel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F5C6C2',
  },
  cancelText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.danger },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
