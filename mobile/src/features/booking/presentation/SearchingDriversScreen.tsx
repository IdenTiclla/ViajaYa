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
import type { Place } from '@/features/booking/domain/types';
import {
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
  cancelPending,
  cancelError,
  onCancelRequest,
  onEditReady,
  onRetry,
}: {
  rideId: string | null;
  origin: Place | null;
  destination: Place | null;
  /** Oferta vigente del viaje (en vivo). */
  currentFare: number | null;
  connectionError?: unknown;
  cancelPending: boolean;
  cancelError?: unknown;
  onCancelRequest: () => void;
  onEditReady: (rideId?: string) => void;
  onRetry?: () => void;
}) {
  const updateFare = useUpdateRideFare();
  const pauseForEdit = usePauseForEdit();
  const negotiationBusy = cancelPending || updateFare.isPending || pauseForEdit.isPending;

  const [fareInput, setFareInput] = useState<string | null>(null);
  const pendingFareRef = useRef<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const hasConnectionError = connectionError != null;
  // La hoja no tiene una altura fija: medirla evita que el trayecto quede
  // descentrado o cubierto en pantallas pequeñas y grandes.
  const mapBottomPadding = sheetHeight > 0 ? sheetHeight + spacing.lg : 440;

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const onCancel = () => {
    setConfirmCancel(false);
    if (negotiationBusy) return;
    onCancelRequest();
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
      onEditReady();
      return;
    }
    // Pausa la búsqueda antes de editar: así se oculta del pool sin cancelarla.
    pauseForEdit.mutate(rideId, {
      onSuccess: () => onEditReady(rideId),
    });
  };

  return (
    <View style={styles.root}>
      {origin && destination ? (
        <TripRouteMap
          origin={origin}
          destination={destination}
          topPadding={160}
          bottomPadding={mapBottomPadding}
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

        <KeyboardAvoidingView
          style={styles.sheetAvoider}
          behavior="padding"
          enabled={Platform.OS === 'ios' || keyboardVisible}
          keyboardVerticalOffset={0}
          pointerEvents="box-none">
          <SafeAreaView
            edges={['bottom']}
            style={styles.sheet}
            onLayout={(event) => {
              if (!keyboardVisible) setSheetHeight(event.nativeEvent.layout.height);
            }}>
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
              <IconoSincronizacionGiratorio conError={hasConnectionError} />
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
          {cancelError != null && (
            <Text style={styles.error}>{getApiErrorMessage(cancelError)}</Text>
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
              {cancelPending ? 'Cancelando…' : 'Cancelar solicitud'}
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

/** Indicador de sincronización activo durante toda la búsqueda de ofertas. */
function IconoSincronizacionGiratorio({ conError }: { conError: boolean }) {
  const [giro] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animacion = Animated.loop(
      Animated.timing(giro, {
        toValue: 1,
        duration: 1_200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animacion.start();
    return () => animacion.stop();
  }, [giro]);

  const rotate = giro.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={{ transform: [{ rotate }] }}
      pointerEvents="none"
      accessibilityElementsHidden>
      <Ionicons
        name={conError ? 'refresh' : 'sync'}
        size={18}
        color={conError ? colors.danger : colors.primary}
      />
    </Animated.View>
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

  sheet: {
    width: '100%',
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
