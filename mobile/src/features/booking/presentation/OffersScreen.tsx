/**
 * Ofertas en vivo (pasajero).
 *
 * Mapa de fondo con el trayecto y, superpuestas, las tarjetas de
 * los conductores que ofertaron. El pasajero **decide**: al pulsar Aceptar se le
 * asigna el viaje (transacción atómica en el backend) y se muestra un overlay de
 * confirmación antes de pasar al viaje en curso. Puede **rechazar** ofertas o
 * **modificar** la solicitud (la pausa del pool y abre la edición) y **cancelar**
 * (las únicas dos formas de salir de la negociación).
 *
 * La solicitud no caduca por tiempo; cada oferta vive 30 s (`expiresAt`) con su
 * propio contador por tarjeta. Mientras no llegan ofertas se muestra la pantalla
 * de búsqueda.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { getApiErrorMessage, getApiErrorStatus } from '@/core/errors/apiError';
import { useBlockHardwareBack } from '@/core/navigation/useBlockHardwareBack';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { ConfirmationOverlay } from '@/features/booking/presentation/ConfirmationOverlay';
import { SearchingDriversScreen } from '@/features/booking/presentation/SearchingDriversScreen';
import { TarjetaOferta } from '@/features/booking/presentation/TarjetaOferta';
import {
  useAcceptOffer,
  useCancelRide,
  usePauseForEdit,
  useRejectOffer,
} from '@/features/rides/application/useRideMutations';
import { useRide, useRideOffers } from '@/features/rides/application/useRides';
import { deriveOfferTags, primaryTag } from '@/features/rides/domain/offerTags';
import type { Offer } from '@/features/rides/domain/types';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { Button, ConfirmDialog, FeedbackState } from '@/shared/components';

export function OffersScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;

  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const fare = useBookingStore((s) => s.fare);

  const rideQuery = useRide(id);
  const { ride } = rideQuery;
  // Tras reiniciar la app el Zustand de booking esta vacio; el viaje persistido
  // es la fuente de verdad para reconstruir mapa y resumen.
  const displayOrigin = ride?.origin ?? origin;
  const displayDestination = ride?.destination ?? destination;
  // Solo cuenta como asignado si hay conductor real; al cancelar, el viaje pasa
  // a 'cancelled' y NO debe llevar a la pantalla de viaje (vendría a mostrar
  // "Viaje cancelado"). El handler de cancelar ya envía al inicio directamente.
  const assigned = !!ride && ride.status !== 'searching' && ride.status !== 'cancelled';
  const cancelled = ride?.status === 'cancelled';
  useBlockHardwareBack(Boolean(ride) && !cancelled);
  const offersQuery = useRideOffers(id, !assigned && !cancelled);
  const { offers } = offersQuery;
  const acceptOffer = useAcceptOffer();
  const rejectOffer = useRejectOffer();
  const cancelRide = useCancelRide();
  const pauseForEdit = usePauseForEdit();

  // Descartes locales: tarjetas que el pasajero quitó de su pantalla.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Tick por segundo para que las ofertas vencidas desaparezcan solas.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const visibleOffers = useMemo(
    () =>
      offers.filter(
        (o) =>
          !dismissed.has(o.id) &&
          (o.expiresAt == null || new Date(o.expiresAt).getTime() > now),
      ),
    [offers, dismissed, now],
  );

  // Tags derivados client-side (ECONÓMICO / RÁPIDO / FAVORITO).
  const tagsMap = useMemo(() => deriveOfferTags(visibleOffers), [visibleOffers]);

  const [confirming, setConfirming] = useState(false);
  // Se activa antes de disparar el HTTP. El backend publica `ride_status`
  // accepted antes de responder, asi que esta intencion evita que ese evento
  // navegue a Trip y desmonte la confirmacion local prematuramente.
  const [acceptIntent, setAcceptIntent] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [offerToReject, setOfferToReject] = useState<Offer | null>(null);
  const [returningHome, setReturningHome] = useState(false);
  const [editTarget, setEditTarget] = useState<{ rideId?: string } | null>(null);
  const returningHomeRef = useRef(false);
  const editingRef = useRef(false);
  const confirmationVisible = confirming || (assigned && acceptIntent);
  const activeOfferToReject =
    offerToReject && visibleOffers.some((offer) => offer.id === offerToReject.id)
      ? offerToReject
      : null;

  const beginReturnHome = useCallback(() => {
    if (returningHomeRef.current) return;
    returningHomeRef.current = true;
    useBookingStore.getState().resetTrip();
    setReturningHome(true);
  }, []);

  const beginEdit = useCallback((targetRideId?: string) => {
    if (editingRef.current) return;
    editingRef.current = true;
    setEditTarget({ rideId: targetRideId });
  }, []);

  // Primero desmonta mapa, marcadores y diálogos. En el siguiente frame vuelve
  // al Tabs que ya existe debajo, evitando dos árboles nativos superpuestos.
  useEffect(() => {
    if (!returningHome) return;
    const frame = requestAnimationFrame(() => router.dismissTo('/(app)/(tabs)'));
    return () => cancelAnimationFrame(frame);
  }, [returningHome, router]);

  // Fabric procesa los cambios nativos por frame. Desmontar primero el mapa y
  // navegar dos frames despues evita que react-native-maps reutilice una vista
  // que Android todavia considera hija del arbol anterior.
  useEffect(() => {
    if (!editTarget) return;

    let navigationFrame: number | null = null;
    const teardownFrame = requestAnimationFrame(() => {
      navigationFrame = requestAnimationFrame(() => {
        if (editTarget.rideId) {
          router.replace({
            pathname: '/booking/configure',
            params: { rideId: editTarget.rideId },
          });
        } else {
          router.replace('/booking/configure');
        }
      });
    });

    return () => {
      cancelAnimationFrame(teardownFrame);
      if (navigationFrame != null) cancelAnimationFrame(navigationFrame);
    };
  }, [editTarget, router]);

  // Backup: si el viaje queda asignado por otra vía (p. ej. WS), ir al viaje.
  useEffect(() => {
    if (assigned && id && !confirmationVisible) {
      router.replace({ pathname: '/booking/trip', params: { rideId: id } });
    }
  }, [assigned, id, confirmationVisible, router]);

  // Esta es la única autoridad de salida, tanto para cancelación local como para
  // un evento recibido desde otro dispositivo. El ref impide navegar dos veces.
  useEffect(() => {
    if (!cancelled || cancelRide.isPending || confirmationVisible) return;
    beginReturnHome();
  }, [beginReturnHome, cancelled, cancelRide.isPending, confirmationVisible]);

  const onAccept = (offer: Offer) => {
    if (acceptOffer.isPending) return;
    setAcceptIntent(true);
    // Aceptar asigna el viaje (decisión final): mostramos el overlay al confirmar.
    acceptOffer.mutate(offer.id, {
      onSuccess: () => {
        setConfirming(true);
        setAcceptIntent(false);
      },
      onError: (error) => {
        setAcceptIntent(false);
        // La oferta murió en el camino (expiró/retirada/otro la tomó): la quitamos.
        if (getApiErrorStatus(error) === 409) {
          setDismissed((prev) => new Set(prev).add(offer.id));
        }
      },
    });
  };

  const handleConfirmed = () => {
    setConfirming(false);
    if (id) router.replace({ pathname: '/booking/trip', params: { rideId: id } });
  };

  const rejectConfirmed = (offer: Offer) => {
    if (acceptOffer.isPending || rejectOffer.isPending) return;
    setDismissed((prev) => new Set(prev).add(offer.id));
    if (!id) return;

    rejectOffer.mutate(
      { offerId: offer.id, rideId: id },
      {
        onError: () => {
          setDismissed((prev) => {
            const next = new Set(prev);
            next.delete(offer.id);
            return next;
          });
        },
      },
    );
  };

  const onModify = () => {
    if (
      acceptOffer.isPending ||
      rejectOffer.isPending ||
      pauseForEdit.isPending ||
      cancelRide.isPending ||
      !id
    ) return;
    // Pausa la solicitud (la oculta del pool) y abre la edición sin cancelar.
    pauseForEdit.mutate(id, {
      onSuccess: () => beginEdit(id),
    });
  };

  const cancelRequest = () => {
    if (
      acceptOffer.isPending ||
      rejectOffer.isPending ||
      pauseForEdit.isPending ||
      cancelRide.isPending
    ) return;
    if (!id) {
      beginReturnHome();
      return;
    }
    // Resetea el store recién cuando el backend confirma: si la red falla, el
    // usuario se queda en la pantalla con el error (sin ride huérfano).
    cancelRide.mutate(id, {
      onSuccess: beginReturnHome,
    });
  };

  const onCancel = () => {
    setConfirmCancel(false);
    cancelRequest();
  };

  // Solo la oferta elegida muestra el progreso; las decisiones se bloquean
  // mientras termina cualquiera de las operaciones de negociación.
  const acceptingId = acceptOffer.isPending ? acceptOffer.variables ?? null : null;
  const negotiationBusy =
    acceptOffer.isPending ||
    rejectOffer.isPending ||
    pauseForEdit.isPending ||
    cancelRide.isPending ||
    editTarget != null;

  if (returningHome || editTarget) return <View style={styles.root} />;

  if (!id || (!ride && rideQuery.isError)) {
    return (
      <SafeAreaView style={styles.root}>
        <FeedbackState
          title={id ? 'No pudimos cargar tu solicitud' : 'La solicitud no es válida'}
          message={id ? getApiErrorMessage(rideQuery.error) : undefined}
          actionLabel={id ? 'Reintentar' : undefined}
          onAction={id ? () => void rideQuery.refetch() : undefined}
        />
        <Button title="Volver al inicio" variant="secondary" onPress={beginReturnHome} />
      </SafeAreaView>
    );
  }

  if (assigned && !confirmationVisible) {
    // El viaje quedó asignado: el overlay ya navegó, o este es el respaldo.
    return null;
  }

  // Mientras el overlay de confirmación está activo NO se cambia a la pantalla
  // de búsqueda: si la oferta aceptada (única visible) expira en ese instante,
  // desmontar el overlay dejaría `confirming` colgado y al pasajero sin navegar.
  if (visibleOffers.length === 0 && !confirmationVisible) {
    return (
      <SearchingDriversScreen
        rideId={id}
        origin={displayOrigin}
        destination={displayDestination}
        currentFare={ride?.fare ?? (fare ? Number(fare.replace(',', '.')) : null)}
        connectionError={rideQuery.error ?? offersQuery.error}
        cancelPending={cancelRide.isPending}
        cancelError={cancelRide.isError ? cancelRide.error : undefined}
        onCancelRequest={cancelRequest}
        onEditReady={beginEdit}
        onRetry={() => {
          void rideQuery.refetch();
          void offersQuery.refetch();
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      {displayOrigin && displayDestination ? (
        <TripRouteMap
          origin={displayOrigin}
          destination={displayDestination}
          topPadding={100}
          bottomPadding={170}
        />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <SafeAreaView edges={['top']} style={styles.overlay} pointerEvents="box-none">
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}>
          <View style={styles.liveHeader} pointerEvents="none">
            <View style={styles.liveTitleRow}>
              <Text style={styles.liveTitle}>Ofertas en vivo</Text>
              <LiveDot />
            </View>
            <Text style={styles.liveSubtitle}>
              {visibleOffers.length}{' '}
              {visibleOffers.length === 1 ? 'oferta disponible' : 'ofertas disponibles'}
            </Text>
            <Text style={styles.liveSubtitle}>Compara el precio y la llegada antes de aceptar.</Text>
          </View>
          {(rideQuery.isError || offersQuery.isError) && (
            <TouchableOpacity
              style={styles.connectionWarning}
              onPress={() => {
                void rideQuery.refetch();
                void offersQuery.refetch();
              }}
              accessibilityRole="button"
              accessibilityLabel="Reintentar actualización de ofertas">
              <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
              <Text style={styles.connectionWarningText}>
                No pudimos actualizar las ofertas. Toca para reintentar.
              </Text>
              <Ionicons name="refresh" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}
          {(acceptOffer.isError || rejectOffer.isError) && (
            <Text style={styles.error}>
              {getApiErrorMessage(
                acceptOffer.isError ? acceptOffer.error : rejectOffer.error,
              )}
            </Text>
          )}
          {visibleOffers.map((offer) => (
            <TarjetaOferta
              key={offer.id}
              offer={offer}
              tag={primaryTag(tagsMap[offer.id])}
              now={now}
              acceptingId={acceptingId}
              decisionsLocked={negotiationBusy}
              onAccept={() => onAccept(offer)}
              onReject={() => setOfferToReject(offer)}
            />
          ))}
          <View style={styles.listBottomSpacer} />
        </ScrollView>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.actionsSheet}>
        {pauseForEdit.isError && (
          <Text style={styles.error}>{getApiErrorMessage(pauseForEdit.error)}</Text>
        )}
        {cancelRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(cancelRide.error)}</Text>
        )}
        <Button
          title="Modificar solicitud"
          variant="secondary"
          leadingIcon="create-outline"
          loading={pauseForEdit.isPending}
          loadingLabel="Abriendo solicitud…"
          onPress={onModify}
          disabled={negotiationBusy || !id}
        />
        <Button
          title="Cancelar solicitud"
          variant="dangerSoft"
          leadingIcon="close"
          loading={cancelRide.isPending}
          loadingLabel="Cancelando…"
          onPress={() => setConfirmCancel(true)}
          disabled={negotiationBusy}
        />
      </SafeAreaView>

      <ConfirmationOverlay visible={confirmationVisible} onDone={handleConfirmed} />

      <ConfirmDialog
        visible={confirmCancel}
        icon="warning"
        destructive
        title="¿Cancelar solicitud?"
        message="Si cancelas, perderás las ofertas de los conductores que ya están evaluando tu viaje y volverás a empezar."
        confirmText="Sí, cancelar"
        cancelText="Seguir negociando"
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        visible={activeOfferToReject != null}
        icon="remove-circle-outline"
        title="¿Descartar esta oferta?"
        message={
          activeOfferToReject
            ? `La oferta de ${activeOfferToReject.driver.fullName} dejará de aparecer en tu negociación.`
            : undefined
        }
        confirmText="Descartar oferta"
        cancelText="Conservar"
        onConfirm={() => {
          const offer = activeOfferToReject;
          setOfferToReject(null);
          if (offer) rejectConfirmed(offer);
        }}
        onCancel={() => setOfferToReject(null)}
      />
    </View>
  );
}

/** Punto verde que late: indicador "en vivo". */
function LiveDot() {
  const reducirMovimiento = useReducedMotion();
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reducirMovimiento) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, reducirMovimiento]);
  return (
    <Animated.View
      accessible={false}
      style={[styles.liveDot, { opacity: reducirMovimiento ? 1 : value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceMuted },

  overlay: { flex: 1 },

  // Cabecera opaca para conservar la legibilidad sobre el mapa.
  liveHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  liveTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveTitle: { flexShrink: 1, fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  liveDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.success },
  liveSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

  // Lista de tarjetas.
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.sm, gap: spacing.sm, paddingBottom: spacing.lg },
  connectionWarning: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(217,45,32,0.28)',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  connectionWarningText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  listBottomSpacer: { height: spacing.md },

  actionsSheet: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },

  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
