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
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { formatBolivianos } from '@/features/rides/domain/money';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { RouteSummary } from '@/features/rides/presentation/RouteSummary';
import { ConfirmDialog } from '@/shared/components';

/** Incrementos rápidos de la oferta (en Bs). */
const QUICK_INCREMENTS = [
  { delta: 2, hint: 'Menor ajuste' },
  { delta: 5, hint: 'Ajuste medio' },
  { delta: 10, hint: 'Ajuste alto' },
] as const;

export function SearchingDriversScreen({
  rideId,
  origin,
  destination,
  currentFare,
  connectionError,
  onRetry,
}: {
  rideId: string | null;
  origin: Place | null;
  destination: Place | null;
  /** Oferta vigente del viaje (en vivo); base para los incrementos. */
  currentFare: number | null;
  connectionError?: unknown;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const cancelRide = useCancelRide();
  const updateFare = useUpdateRideFare();
  const pauseForEdit = usePauseForEdit();
  const negotiationBusy =
    cancelRide.isPending || updateFare.isPending || pauseForEdit.isPending;

  const [customIncrease, setCustomIncrease] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Algunos Android conservan la altura reducida del KeyboardAvoidingView al
  // ocultar el teclado; al remontarlo, la hoja vuelve a anclarse abajo.
  const [keyboardAvoiderKey, setKeyboardAvoiderKey] = useState(0);
  const hasConnectionError = connectionError != null;

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardAvoiderKey((key) => key + 1);
    });
    return () => subscription.remove();
  }, []);

  // La búsqueda no caduca: se sale al modificar (pausa y edita) o cancelar.
  const onModify = () => {
    if (negotiationBusy) return;
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
    if (negotiationBusy) return;
    if (!rideId) {
      useBookingStore.getState().resetTrip();
      router.replace('/(app)/(tabs)');
      return;
    }
    // Resetea el store recién cuando el backend confirma el cancel.
    cancelRide.mutate(rideId, {
      onSuccess: () => {
        useBookingStore.getState().resetTrip();
        router.replace('/(app)/(tabs)');
      },
    });
  };

  // Aumentar la oferta = oferta actual + incremento (redondeado a 2 decimales).
  // Requiere conocer la oferta vigente; sin ella (ride aún cargando) no aplicamos.
  const applyIncrease = (delta: number) => {
    if (!rideId || updateFare.isPending || delta <= 0 || currentFare == null) return;
    const next = Math.round((currentFare + delta) * 100) / 100;
    updateFare.mutate({ rideId, fare: next });
  };

  const fareLocked = currentFare == null || negotiationBusy;
  const customIncreaseValue = Number(customIncrease.replace(',', '.'));
  const customIncreaseIsValid = Number.isFinite(customIncreaseValue) && customIncreaseValue > 0;

  const applyCustomIncrease = () => {
    if (!rideId || fareLocked || !customIncreaseIsValid || currentFare == null) return;
    const next = Math.round((currentFare + customIncreaseValue) * 100) / 100;
    updateFare.mutate(
      { rideId, fare: next },
      {
        onSuccess: () => {
          setCustomIncrease('');
          Keyboard.dismiss();
        },
      },
    );
  };

  return (
    <View style={styles.root}>
      {origin && destination ? (
        <TripRouteMap
          origin={origin}
          destination={destination}
          topPadding={170}
          bottomPadding={440}
        />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <View style={styles.scrim} pointerEvents="box-none">
        <SafeAreaView edges={['top']} style={styles.topArea} pointerEvents="box-none">
          <RouteSummary
            origin={origin ?? { name: 'Tu ubicación' }}
            destination={destination ?? { name: 'Destino' }}
          />
        </SafeAreaView>

        <View style={styles.center} pointerEvents="none">
          <PulseLoader />
        </View>

        <KeyboardAvoidingView
          key={keyboardAvoiderKey}
          style={styles.sheetAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents="box-none">
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            bounces={false}>
          <View style={styles.sheetHandle} />

          {/* Estado de búsqueda */}
          <View style={styles.statusRow}>
            <View style={styles.statusText}>
              <View style={styles.statusTitleRow}>
                <View style={[styles.liveDot, hasConnectionError && styles.offlineDot]} />
                <Text style={[styles.statusTitle, hasConnectionError && styles.offlineTitle]}>
                  {hasConnectionError ? 'Reconectando…' : 'Buscando ofertas…'}
                </Text>
              </View>
              <Text style={styles.statusSubtitle} numberOfLines={2}>
                {hasConnectionError
                  ? getApiErrorMessage(connectionError)
                  : 'Conectando con conductores cercanos'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.syncBadge}
              onPress={onRetry}
              disabled={!hasConnectionError || !onRetry}
              accessibilityRole={hasConnectionError ? 'button' : undefined}
              accessibilityLabel={hasConnectionError ? 'Reintentar conexión' : undefined}>
              <Ionicons
                name={hasConnectionError ? 'refresh' : 'sync'}
                size={18}
                color={hasConnectionError ? colors.danger : colors.primary}
              />
            </TouchableOpacity>
          </View>

          {/* Aumentar oferta */}
          <View style={styles.bidHeader}>
            <Text style={styles.bidTitle}>Aumentar oferta</Text>
            <Text style={styles.bidHint}>Monto adicional</Text>
          </View>
          {currentFare != null && (
            <Text style={styles.currentFare}>Tu oferta actual: Bs {formatBolivianos(currentFare)}</Text>
          )}

          <View style={styles.bidGrid}>
            {QUICK_INCREMENTS.map((inc, i) => (
              <TouchableOpacity
                key={inc.delta}
                style={[
                  styles.bidBtn,
                  i === 0 && styles.bidBtnSuggested,
                  fareLocked && styles.disabled,
                ]}
                onPress={() => applyIncrease(inc.delta)}
                disabled={fareLocked}
                accessibilityRole="button"
                accessibilityLabel={`Aumentar oferta en ${inc.delta} bolivianos`}>
                <Text style={styles.bidAmount}>+Bs {inc.delta}</Text>
                <Text style={styles.bidHintSmall}>{inc.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.customInputRow, fareLocked && styles.disabled]}>
            <View style={styles.customInputLabel}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.customBtnText}>Monto personalizado</Text>
            </View>
            <View style={styles.customInputControls}>
              <Text style={styles.customCurrency}>Bs</Text>
              <TextInput
                value={customIncrease}
                onChangeText={setCustomIncrease}
                placeholder="5"
                placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={9}
                returnKeyType="done"
                onSubmitEditing={applyCustomIncrease}
                editable={!fareLocked}
                style={styles.customAmountInput}
                accessibilityLabel="Aumentar oferta en bolivianos"
              />
              <TouchableOpacity
                style={[styles.customApply, (!customIncreaseIsValid || fareLocked) && styles.disabled]}
                onPress={applyCustomIncrease}
                disabled={!customIncreaseIsValid || fareLocked}
                accessibilityRole="button"
                accessibilityLabel="Aplicar aumento personalizado">
                <Text style={styles.customApplyText}>Aplicar</Text>
              </TouchableOpacity>
            </View>
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
            style={[styles.modify, negotiationBusy && styles.disabled]}
            onPress={onModify}
            disabled={negotiationBusy}
            accessibilityRole="button"
            accessibilityLabel="Modificar solicitud">
            <Ionicons name="create-outline" size={20} color={colors.primary} />
            <Text style={styles.modifyText}>Modificar solicitud</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cancel, negotiationBusy && styles.disabled]}
            onPress={() => setConfirmCancel(true)}
            disabled={negotiationBusy}
            accessibilityRole="button"
            accessibilityLabel="Cancelar solicitud">
            <Ionicons name="close" size={18} color={colors.danger} />
            <Text style={styles.cancelText}>
              {cancelRide.isPending ? 'Cancelando…' : 'Cancelar solicitud'}
            </Text>
          </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
        </KeyboardAvoidingView>
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sheetAvoider: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
  },

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
    maxHeight: '88%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
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
  offlineDot: { backgroundColor: colors.danger },
  statusTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  offlineTitle: { color: colors.danger },
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

  customInputRow: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customInputLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  customInputControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  customBtnText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.primary },
  customCurrency: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  customAmountInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: fontSize.md, paddingVertical: 0, textAlign: 'right' },
  customApply: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.primary },
  customApplyText: { color: colors.textOnPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

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
