import {
  AudioGuidance, CameraPerspective, MapColorScheme, NavigationNightMode,
  NavigationProvider, NavigationView, TaskRemovedBehavior, TravelMode, useNavigation,
  type NavigationViewController,
} from '@googlemaps/react-native-navigation-sdk';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontSize, spacing, useEstilos, type Tema } from '@/core/theme';
import { useEstiloMapa } from '@/features/booking/presentation/mapStyle';
import type { Ride } from '@/features/rides/domain/types';
import { Button } from '@/shared/components';
import { DriverSharingStatus } from '@/features/tracking/presentation/DriverSharingStatus';
import { runNavigationSession } from '../application/navigationSession';
import { useWazeNavigation } from '../application/useWazeNavigation';
import { navigationErrorMessage, navigationTarget } from '../domain/navigationTarget';

const terms = { title: 'Navegación de ViajaYa', companyName: 'ViajaYa' };
// Native SDK is a singleton. A replacement waits for the previous cleanup.
let sessionQueue = Promise.resolve();

export function NativeDriverNavigation({ ride }: { ride: Ride }) {
  return <NavigationProvider termsAndConditionsDialogOptions={terms} taskRemovedBehavior={TaskRemovedBehavior.QUIT_SERVICE}>
    <NavigationContent ride={ride} />
  </NavigationProvider>;
}
function NavigationContent({ ride }: { ride: Ride }) {
  const { styles } = useEstilos(createStyles);
  const { estiloMapa, modoMapa } = useEstiloMapa();
  const router = useRouter();
  const { navigationController, setOnLocationChanged, setOnArrival } = useNavigation();
  const target = navigationTarget(ride)!;
  const targetRef = useRef(target);
  useEffect(() => { targetRef.current = target; }, [target]);
  const [mapReady, setMapReady] = useState(false);
  const [locationAllowed, setLocationAllowed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState('Preparando indicaciones…');
  const [error, setError] = useState<string | null>(null);
  const view = useRef<NavigationViewController | null>(null);
  const session = useRef<{ abort: AbortController; done: Promise<void> } | null>(null);
  const pause = async () => {
    setPaused(true);
    session.current?.abort.abort();
    await session.current?.done;
  };
  const waze = useWazeNavigation(target, pause);

  useEffect(() => {
    if (!mapReady || paused) return;
    const abort = new AbortController();
    const live = () => !abort.signal.aborted;
    let gotLocation = false;
    let initialized = false;
    let locationReady: (() => void) | undefined;
    const location = new Promise<void>(resolve => { locationReady = resolve; });
    const run = sessionQueue.catch(() => {}).then(async () => {
      if (!live()) return;
      setError(null); setStatus('Buscando tu ubicación y calculando la ruta…');
      setOnLocationChanged(() => { gotLocation = true; locationReady?.(); });
      setOnArrival(() => { if (live()) setStatus('Estás cerca del punto. Vuelve al viaje para confirmar tu llegada.'); });
      await runNavigationSession({
        requestPermission: async () => {
          const existingPermission = await Location.getForegroundPermissionsAsync();
          if (!live()) return false;
          const permission = existingPermission.granted ? existingPermission : await Location.requestForegroundPermissionsAsync();
          if (live()) setLocationAllowed(permission.granted);
          if (!await Location.hasServicesEnabledAsync()) throw new Error('LOCATION_DISABLED');
          return permission.granted;
        },
        acceptTerms: () => navigationController.showTermsAndConditionsDialog(),
        initialize: async () => {
          const result = await navigationController.init();
          initialized = result === 'ok';
          return result;
        },
        startLocationUpdates: () => navigationController.startUpdatingLocation(),
        waitForLocation: () => gotLocation ? Promise.resolve() : location,
        setDestination: selected => navigationController.setDestinations([
          { title: selected.place.name, position: { lat: selected.place.coordinates.latitude, lng: selected.place.coordinates.longitude } },
        ], { routingOptions: { travelMode: selected.motorcycle ? TravelMode.TWO_WHEELER : TravelMode.DRIVING } }),
        start: async () => {
          navigationController.setAudioGuidanceType(AudioGuidance.VOICE_ALERTS_AND_GUIDANCE | AudioGuidance.BLUETOOTH_AUDIO);
          await navigationController.startGuidance();
          await view.current?.setFollowingPerspective(CameraPerspective.TOP_DOWN_HEADING_UP);
        },
        stop: async () => {
          setOnLocationChanged(null); setOnArrival(null);
          if (!initialized) return;
          navigationController.stopUpdatingLocation();
          navigationController.setAudioGuidanceType(AudioGuidance.SILENT);
          try { await navigationController.stopGuidance(); } finally { await navigationController.cleanup(); }
        },
      }, targetRef.current, abort.signal, () => { if (live()) setStatus('Sigue las indicaciones de voz.'); });
    }).catch(reason => { if (live()) setError(navigationErrorMessage(reason instanceof Error ? reason.message : 'unknown')); });
    sessionQueue = run;
    session.current = { abort, done: run };
    return () => { abort.abort(); };
  }, [mapReady, paused, attempt, target.key, navigationController, setOnLocationChanged, setOnArrival]);

  return <SafeAreaView style={styles.root}>
    <View style={styles.map}>
      <NavigationView style={StyleSheet.absoluteFill} onMapReady={() => setMapReady(true)}
        onNavigationViewControllerCreated={controller => { view.current = controller; }}
        mapStyle={JSON.stringify(estiloMapa)}
        mapColorScheme={modoMapa === 'dark' ? MapColorScheme.DARK : MapColorScheme.LIGHT}
        navigationNightMode={modoMapa === 'dark' ? NavigationNightMode.FORCE_NIGHT : NavigationNightMode.FORCE_DAY}
        buildingsEnabled={false} indoorEnabled={false} indoorLevelPickerEnabled={false}
        myLocationEnabled={locationAllowed}
        tiltGesturesEnabled={false} rotateGesturesEnabled={false} scrollGesturesEnabled={false}
        scrollGesturesDuringRotateOrZoomEnabled={false} zoomGesturesEnabled={false}
        mapToolbarEnabled={false} reportIncidentButtonEnabled={false} />
    </View>
    <ScrollView style={styles.panel} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{target.label} · {target.place.name}</Text>
      <Text style={error ? styles.error : styles.hint} accessibilityLiveRegion="polite">
        {error ?? (paused ? 'Navegación integrada en pausa. Tu ubicación se sigue compartiendo.' : status)}
      </Text>
      <DriverSharingStatus rideId={ride.id} />
      {(error || paused) && <Button title={paused ? 'Usar navegación integrada' : 'Reintentar navegación'}
        onPress={() => { setPaused(false); setAttempt(value => value + 1); }} />}
      <View style={styles.actions}>
        <Button title="Volver al viaje" style={styles.grow} onPress={() => router.back()} />
        <Button title="Waze" variant="secondary" leadingIcon="open-outline" loading={waze.opening} onPress={waze.open} />
      </View>
      {waze.error && <Text style={styles.error} accessibilityRole="alert">{waze.error}</Text>}
      {target.motorcycle && <Text style={styles.hint}>En Waze, revisa que el vehículo esté configurado como motocicleta.</Text>}
    </ScrollView>
  </SafeAreaView>;
}
const createStyles = ({ colors }: Tema) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, map: { flex: 1, minHeight: 180 },
  panel: { maxHeight: '42%', flexGrow: 0, backgroundColor: colors.surface },
  content: { padding: spacing.md, gap: spacing.sm }, title: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm }, error: { color: colors.danger, fontSize: fontSize.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }, grow: { flexGrow: 1 },
});
