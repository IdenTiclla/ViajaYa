import { formatBolivianos } from '@/features/rides/domain/money';
import { TripProgress } from '@/features/rides/presentation/TripProgress';
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
import { Ionicons } from '@react-native-vector-icons/ionicons';
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
import { controles, fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
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
import { orderOffers, type OfferOrder } from '@/features/rides/domain/offerComparison';
import type { Offer } from '@/features/rides/domain/types';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { TripSecondaryAction } from '@/features/rides/presentation/TripSecondaryAction';
import { Button, ConfirmDialog, FeedbackState } from '@/shared/components';

export function OffersScreen() {
  const { colors, styles } = useEstilos(crearEstilos);
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;

  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const service = useBookingStore((s) => s.service);
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
  const [offerOrder, setOfferOrder] = useState<OfferOrder>('recent');
  const orderedOffers = useMemo(() => orderOffers(visibleOffers, offerOrder), [visibleOffers, offerOrder]);

  const [confirming, setConfirming] = useState(false);
  const [offerToAccept, setOfferToAccept] = useState<Offer | null>(null);
  const acceptingRef = useRef(false);
  const [sheetHeight, setSheetHeight] = useState(500);
  const activeOfferToAccept = offerToAccept
    ? visibleOffers.find((offer) => offer.id === offerToAccept.id) ?? null : null;
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
    if (!id || acceptOffer.isPending || acceptingRef.current
      || (offer.expiresAt != null && Date.parse(offer.expiresAt) <= Date.now())) return;
    acceptingRef.current = true;
    setAcceptIntent(true);
    // Aceptar asigna el viaje (decisión final): mostramos el overlay al confirmar.
    acceptOffer.mutate({ offerId: offer.id, rideId: id }, {
      onSettled: () => { acceptingRef.current = false; },
      onSuccess: (savedRide) => {
        setConfirming(savedRide.status === 'accepted');
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
  const acceptingId = acceptOffer.isPending ? acceptOffer.variables?.offerId ?? null : null;
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
  if (visibleOffers.length === 0 && !confirmationVisible && offerToAccept == null) {
    return (
      <SearchingDriversScreen
        service={ride?.service ?? service}
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
          service={ride?.service ?? service}
          origin={displayOrigin}
          destination={displayDestination}
          topPadding={48}
          bottomPadding={sheetHeight}
        />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <View style={styles.overlay} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent} bounces={false}>
          <View style={styles.liveHeader} pointerEvents="none">
            <TripProgress status="searching" />
            <View style={styles.liveTitleRow}>
              <Text style={styles.liveTitle}>Ofertas en vivo</Text>
              <LiveDot />
            </View>
            <Text style={styles.liveSubtitle}>
              {visibleOffers.length}{' '}
              {visibleOffers.length === 1 ? 'oferta disponible' : 'ofertas disponibles'}
            </Text>
            <Text style={styles.liveSubtitle}>Tú eliges. Cada oferta vence en 30 segundos.</Text>
          </View>
          <OfferOrderControl value={offerOrder} onChange={setOfferOrder} />
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
          {orderedOffers.map((offer) => (
            <TarjetaOferta
              key={offer.id}
              offer={offer}
              tag={primaryTag(tagsMap[offer.id])}
              now={now}
              acceptingId={acceptingId}
              decisionsLocked={negotiationBusy}
              onAccept={() => setOfferToAccept(offer)}
              onReject={() => setOfferToReject(offer)}
            />
          ))}
        </ScrollView>

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
        <TripSecondaryAction
          title={cancelRide.isPending ? 'Cancelando…' : 'Cancelar solicitud'}
          onPress={() => setConfirmCancel(true)}
          disabled={negotiationBusy}
        />
      </SafeAreaView>
      </View>

      <ConfirmationOverlay visible={confirmationVisible} onDone={handleConfirmed} />

      <ConfirmDialog visible={offerToAccept != null && !negotiationBusy}
        icon="car-sport-outline" title={activeOfferToAccept ? 'Confirma tu conductor' : 'Oferta no disponible'}
        message={activeOfferToAccept
          ? `${activeOfferToAccept.driver.fullName} · Bs ${formatBolivianos(activeOfferToAccept.price)}. `
            + (activeOfferToAccept.etaMin != null ? `Llegada estimada: ${activeOfferToAccept.etaMin} min. ` : '')
            + [activeOfferToAccept.driver.vehicleModel, activeOfferToAccept.driver.plate].filter(Boolean).join(' · ')
            + '. Al confirmar, este conductor irá a recogerte.'
          : 'La oferta venció o fue retirada. Puedes comparar las ofertas vigentes o seguir buscando.'}
        confirmText={activeOfferToAccept ? 'Confirmar conductor' : 'Ver ofertas'} cancelText="Comparar ofertas"
        onConfirm={() => {
          const offer = activeOfferToAccept;
          setOfferToAccept(null);
          if (offer) onAccept(offer);
        }}
        onCancel={() => setOfferToAccept(null)} />

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

function OfferOrderControl({ value, onChange }: { value: OfferOrder; onChange: (order: OfferOrder) => void }) {
  const { styles, estiloFoco } = useEstilos(crearEstilos);
  const [focused, setFocused] = useState<OfferOrder | null>(null);
  const choices: { value: OfferOrder; label: string; description: string }[] = [
    { value: 'recent', label: 'Recientes', description: 'Ofertas más recientes primero' },
    { value: 'price', label: 'Precio', description: 'Ofertas de menor precio primero' },
    { value: 'arrival', label: 'Llegada', description: 'Ofertas de menor tiempo de llegada primero' },
  ];
  return <View style={styles.orderControl} accessibilityRole="tablist" accessibilityLabel="Ordenar ofertas">
    {choices.map(choice => <TouchableOpacity key={choice.value} accessibilityRole="tab"
      accessibilityLabel={choice.description} accessibilityState={{ selected: value === choice.value }}
      onPress={() => onChange(choice.value)} onFocus={() => setFocused(choice.value)} onBlur={() => setFocused(null)}
      style={[styles.orderButton, value === choice.value && styles.orderSelected, focused === choice.value && estiloFoco]}>
      {value === choice.value && <Ionicons accessible={false} name="checkmark" size={16} color={styles.orderSelectedLabel.color} />}
      <Text style={[styles.orderLabel, value === choice.value && styles.orderSelectedLabel]}>{choice.label}</Text>
    </TouchableOpacity>)}
  </View>;
}

/** Punto verde que late: indicador "en vivo". */
function LiveDot() {
  const { styles } = useEstilos(crearEstilos);
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

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceMuted },

  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '64%',
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm, overflow: 'hidden' },
  orderControl: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
    padding: spacing.xs, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  orderButton: { minHeight: controles.altoMinimo, flexDirection: 'row', gap: spacing.xs,
    flexBasis: 80, flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  orderSelected: { backgroundColor: colors.primary },
  orderLabel: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.textSecondary },
  orderSelectedLabel: { color: colors.textOnPrimary },

  // Cabecera opaca para conservar la legibilidad sobre el mapa.
  liveHeader: { paddingVertical: spacing.xs },
  liveTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveTitle: { flexShrink: 1, fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  liveDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.success },
  liveSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

  // Lista de tarjetas.
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.md },
  connectionWarning: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bordePeligro,
    backgroundColor: colors.surface,
  },
  connectionWarningText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  listBottomSpacer: { height: spacing.md },

  actionsSheet: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
