/**
 * Mapa del conductor "buscando solicitudes": se abre al recibir su ubicación
 * con un marcador anclado al GPS. La cámara sigue al conductor hasta que
 * desplaza el mapa; puede volver a activar el seguimiento con un botón.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useEstiloMapa } from '@/features/booking/presentation/mapStyle';
import type { Coordinates } from '@/core/domain/geo';
import type { WatchStatus } from '@/features/home/application/useWatchPosition';
import { MarcadorVehiculo } from './MarcadorVehiculo';

// Zoom de navegación urbano: muestra unas manzanas alrededor del conductor.
const FOLLOW_DELTA = 0.012;

type Props = {
  coordinates: Coordinates | null;
  heading: number | null;
  tipoVehiculo: 'taxi' | 'moto' | null;
  status: WatchStatus;
  retry: () => void;
  interactivo?: boolean;
};

export function DriverSearchMap(props: Props) {
  const { colors, styles } = useEstilos(crearEstilos);
  const { coordinates, status, retry } = props;
  if (coordinates) return <MapaUbicado {...props} coordinates={coordinates} />;

  const cargando = status === 'loading';
  const abrirConfiguracion = status === 'denied' || status === 'disabled';
  const mensaje = cargando ? 'Buscando tu ubicación…'
    : status === 'disabled' ? 'La ubicación del teléfono está desactivada.'
      : status === 'denied' ? 'Permite el acceso a tu ubicación para mostrarte en el mapa.'
        : 'Todavía no recibimos tu ubicación. Comprueba la señal y que la ubicación esté activada.';
  const configurar = () => {
    if (status === 'disabled' && Platform.OS === 'android') {
      void Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings());
    } else {
      void Linking.openSettings();
    }
  };
  // No mostrar una ciudad fija como si fuera la ubicación del conductor.
  return (
    <View style={styles.container}>
      <View style={styles.permissionOverlay}>
        <View style={styles.permissionCard}>
          {cargando ? <ActivityIndicator color={colors.primary} size="large" />
            : <Ionicons name="location-outline" size={28} color={colors.primary} />}
          <Text style={styles.permissionText} accessibilityLiveRegion="polite">{mensaje}</Text>
          {!cargando && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={abrirConfiguracion ? configurar : retry}
              accessibilityRole="button"
              accessibilityLabel={abrirConfiguracion ? 'Abrir configuración de ubicación' : 'Reintentar ubicación'}>
              <Text style={styles.retryBtnText}>{abrirConfiguracion ? 'Abrir configuración' : 'Reintentar'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function MapaUbicado({ coordinates, heading, tipoVehiculo, interactivo = false }: Props & { coordinates: Coordinates }) {
  const { colors, styles } = useEstilos(crearEstilos);
  const mapRef = useRef<MapView>(null);
  const { estiloMapa, modoMapa } = useEstiloMapa(true);
  const [listo, setListo] = useState(false);
  const [seguir, setSeguir] = useState(true);
  const [solicitudCentrado, setSolicitudCentrado] = useState(0);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const centrado = useRef(false);
  const ultimaSolicitudCentrado = useRef(0);

  const region: Region = {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    latitudeDelta: FOLLOW_DELTA,
    longitudeDelta: FOLLOW_DELTA,
  };

  // Espera al mapa y su layout: la primera posición puede llegar antes que ambos.
  useEffect(() => {
    if (!listo || !seguir || !layout.width || !layout.height) return;
    const frame = requestAnimationFrame(() => {
      const mapa = mapRef.current;
      if (!mapa) return;
      if (!centrado.current || ultimaSolicitudCentrado.current !== solicitudCentrado) {
        // Centrado inicial y explícito sin animación: evita el desplazamiento
        // incorrecto de animateCamera durante el montaje de las pestañas nativas.
        mapa.setCamera({ center: coordinates, ...(!centrado.current ? { zoom: 16, heading: 0, pitch: 0 } : {}) });
      } else {
        mapa.animateCamera({ center: coordinates }, { duration: 500 });
      }
      centrado.current = true;
      ultimaSolicitudCentrado.current = solicitudCentrado;
    });
    return () => cancelAnimationFrame(frame);
  }, [coordinates, listo, seguir, layout, solicitudCentrado]);

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent: { layout: medidas } }) => {
        setLayout((actual) => actual.width === medidas.width && actual.height === medidas.height
          ? actual : { width: medidas.width, height: medidas.height });
      }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        customMapStyle={estiloMapa}
        userInterfaceStyle={modoMapa}
        scrollEnabled={interactivo}
        zoomEnabled={interactivo}
        rotateEnabled={interactivo}
        pitchEnabled={false}
        showsMyLocationButton={false}
        showsCompass={interactivo}
        showsScale={false}
        onMapReady={() => setListo(true)}
        onPanDrag={() => { if (interactivo) setSeguir(false); }}
        onRegionChangeComplete={(_, detalles) => {
          if (interactivo && detalles?.isGesture) setSeguir(false);
        }}>
        <MarcadorVehiculo coordinates={coordinates} heading={heading} tipoVehiculo={tipoVehiculo} />
      </MapView>

      {interactivo && (
        <TouchableOpacity
          style={styles.seguir}
          onPress={() => { setSeguir(true); setSolicitudCentrado((solicitud) => solicitud + 1); }}
          accessibilityRole="button"
          accessibilityLabel="Volver a seguir mi ubicación">
          <Ionicons name="locate" size={20} color={colors.primary} />
          <Text style={styles.seguirTexto}>{seguir ? 'Mi ubicación' : 'Seguir mi ubicación'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  seguir: {
    position: 'absolute', right: spacing.md, bottom: spacing.md,
    minHeight: 48, maxWidth: '90%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.bordeControl,
  },
  seguirTexto: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, flexShrink: 1 },
  permissionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  permissionCard: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  permissionText: {
    fontSize: fontSize.sm,
    color: colors.text,
    textAlign: 'center',
  },
  retryBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  retryBtnText: { color: colors.textOnPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
