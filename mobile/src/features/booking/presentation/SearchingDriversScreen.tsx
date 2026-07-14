/**
 * Buscando ofertas (pasajero) — diseño Stitch "Searching for Offers".
 *
 * Mapa de fondo con el trayecto y un pulso sobre el origen; abajo una tarjeta
 * con el estado de búsqueda, los controles para **ajustar la oferta** y la acción de
 * cancelar la solicitud. Se muestra mientras el viaje sigue
 * `searching` y aún no llegan ofertas; al recibir la primera, `OffersScreen`
 * pasa a la lista.
 *
 * La búsqueda no caduca. Al ajustar la oferta, el nuevo monto se anuncia a los
 * conductores en vivo.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { formatBolivianosInput } from '@/features/rides/domain/money';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { ConfirmDialog } from '@/shared/components';

const PASO_OFERTA = 1;

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
  /** Oferta vigente del viaje (en vivo). */
  currentFare: number | null;
  connectionError?: unknown;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const cancelRide = useCancelRide();
  const updateFare = useUpdateRideFare();
  const pauseForEdit = usePauseForEdit();
  const negotiationBusy = cancelRide.isPending || updateFare.isPending || pauseForEdit.isPending;

  const [fareInput, setFareInput] = useState<string | null>(null);
  const pendingFareRef = useRef<number | null>(null);
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

  const fareLocked = currentFare == null || negotiationBusy;
  const displayedFare = fareInput ?? (currentFare == null ? '' : formatBolivianosInput(currentFare));
  const typedFare = Number(displayedFare.replace(',', '.'));
  const typedFareIsValid = Number.isFinite(typedFare) && typedFare > 0;

  const updateCurrentFare = (nextFare: number) => {
    if (!rideId || fareLocked || !Number.isFinite(nextFare) || nextFare <= 0) return;
    const normalizedFare = Math.round(nextFare * 100) / 100;
    if (normalizedFare === currentFare || pendingFareRef.current != null) return;
    setFareInput(formatBolivianosInput(normalizedFare));
    pendingFareRef.current = normalizedFare;
    updateFare.mutate(
      { rideId, fare: normalizedFare },
      {
        onSettled: () => {
          pendingFareRef.current = null;
          setFareInput(null);
        },
      },
    );
  };

  const applyTypedFare = () => {
    if (!typedFareIsValid) {
      setFareInput(null);
      return;
    }
    if (typedFare === currentFare) setFareInput(null);
    updateCurrentFare(typedFare);
    Keyboard.dismiss();
  };

  const adjustFare = (delta: number) => {
    const baseFare = typedFareIsValid ? typedFare : currentFare;
    if (baseFare == null) return;
    updateCurrentFare(baseFare + delta);
  };

  const onBack = () => {
    if (negotiationBusy) return;
    if (!rideId) {
      router.replace('/(app)/booking/configure');
      return;
    }
    // Pausa la búsqueda antes de editar: así se oculta del pool sin cancelarla.
    pauseForEdit.mutate(rideId, {
      onSuccess: () =>
        router.replace({ pathname: '/(app)/booking/configure', params: { rideId } }),
    });
  };

  return (
    <View style={styles.root}>
      {origin && destination ? (
        <TripRouteMap
          origin={origin}
          destination={destination}
          bottomPadding={440}
          showPlaceNamesInTooltip
        />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <View style={styles.scrim} pointerEvents="box-none">
        <SafeAreaView edges={['top']} style={styles.backArea} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.backButton, negotiationBusy && styles.disabled]}
            onPress={onBack}
            disabled={negotiationBusy}
            accessibilityRole="button"
            accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
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

          {/* Ajuste de oferta */}
          <View style={styles.bidHeader}>
            <Text style={styles.bidTitle}>Tu oferta</Text>
          </View>
          <View style={[styles.fareStepper, fareLocked && styles.disabled]}>
            <TouchableOpacity
              style={styles.fareStepButton}
              onPress={() => adjustFare(-PASO_OFERTA)}
              disabled={fareLocked || !typedFareIsValid || typedFare <= PASO_OFERTA}
              accessibilityRole="button"
              accessibilityLabel="Reducir oferta en un boliviano">
              <Ionicons name="remove" size={22} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.fareInputWrap}>
              <Text style={styles.fareCurrency}>Bs</Text>
              <TextInput
                value={displayedFare}
                onChangeText={setFareInput}
                placeholder="0"
                placeholderTextColor={colors.placeholder}
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={9}
                returnKeyType="done"
                onSubmitEditing={applyTypedFare}
                onBlur={applyTypedFare}
                editable={!fareLocked}
                style={styles.fareAmountInput}
                accessibilityLabel="Precio de tu oferta en bolivianos"
              />
            </View>
            <TouchableOpacity
              style={styles.fareStepButton}
              onPress={() => adjustFare(PASO_OFERTA)}
              disabled={fareLocked}
              accessibilityRole="button"
              accessibilityLabel="Aumentar oferta en un boliviano">
              <Ionicons name="add" size={22} color={colors.primary} />
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backArea: { position: 'absolute', top: 0, left: 0, padding: spacing.md },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },

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

  bidHeader: { alignItems: 'center' },
  bidTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  fareStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fareStepButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fareInputWrap: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  fareCurrency: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  fareAmountInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },

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
