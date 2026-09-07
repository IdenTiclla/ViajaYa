/**
 * Marcador de ruta reutilizable: pin circular con letra (A = origen, B = destino)
 * y un tooltip "Origen"/"Destino" al lado libre de la ruta. Lo usan las vistas de
 * trayecto (pasajero y conductor) para que origen y destino se vean siempre igual.
 *
 * El tooltip va en flujo (no absoluto) para que renderice de forma fiable dentro
 * del marker en iOS y Android; el `anchor` apunta al pin (no al centro del
 * conjunto) para que el punto quede exacto en la coordenada.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';

import { fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';
import { PinLoadingIndicator } from '@/shared/components';
import {
  BORDE_PIN_RUTA,
  calcularAnclajePin,
  elegirPosicionTooltip,
  programarRedibujadoMarcador,
  proyectarRutaRespectoAlPin,
  SEPARACION_TOOLTIP,
  TAMANO_LETRA_PIN_RUTA,
  TAMANO_PIN_RUTA,
  ubicarTooltipSinCruzarRuta,
} from '@/features/rides/presentation/routeTooltipLayout';

type Props = {
  kind: 'A' | 'B';
  coordinate: Coordinates;
  /** Texto del tooltip (p. ej. "Origen", "Destino"). */
  label: string;
  /** Trayecto visible: permite alejar la etiqueta de la ruta junto al pin. */
  ruta?: readonly Coordinates[];
  /** Orientación actual de la cámara, en grados. */
  rumboMapa?: number;
  /** Zoom de Google Maps para comparar el tamaño del texto con el trayecto. */
  zoomMapa?: number;
  /** Oculta el tooltip cuando la información se presenta fuera del mapa. */
  showTooltip?: boolean;
  /** Muestra un control de edición unido al marcador. */
  showEditControl?: boolean;
  /** Atenuar el pin (p. ej. orígenes no seleccionados en el mapa de solicitudes). */
  dim?: boolean;
  /** Jerarquía del marcador cuando varios puntos se superponen. */
  zIndex?: number;
  /** Indica que todavía se está resolviendo el nombre de este punto. */
  loading?: boolean;
  onPress?: () => void;
};

const RUTA_VACIA: readonly Coordinates[] = [];

export function RoutePinMarker({
  kind,
  coordinate,
  label,
  ruta = RUTA_VACIA,
  rumboMapa = 0,
  zoomMapa,
  showTooltip = true,
  showEditControl,
  dim,
  zIndex,
  loading = false,
  onPress,
}: Props) {
  const { colors, styles, modo } = useEstilos(crearEstilos);
  const marcador = useRef<MapMarker>(null);
  const [medidas, setMedidas] = useState({ ancho: 0, alto: TAMANO_PIN_RUTA });
  const [medidasEtiquetas, setMedidasEtiquetas] = useState({
    ancho: 178, alto: showEditControl ? 70 : 40,
  });
  const tieneEtiquetas = Boolean(showTooltip || showEditControl);
  const ubicacion = useMemo(() => {
    const preferida = elegirPosicionTooltip(kind, coordinate, ruta, rumboMapa);
    if (!tieneEtiquetas || zoomMapa == null) {
      return { posicion: preferida, separacion: SEPARACION_TOOLTIP, visible: true };
    }
    return ubicarTooltipSinCruzarRuta(
      proyectarRutaRespectoAlPin(coordinate, ruta, rumboMapa, zoomMapa),
      medidasEtiquetas, preferida,
    );
  }, [kind, coordinate, ruta, rumboMapa, zoomMapa, tieneEtiquetas, medidasEtiquetas]);
  const { posicion, separacion, visible } = ubicacion;
  useEffect(() => programarRedibujadoMarcador(() => marcador.current?.redraw()), [
    medidas.ancho, medidas.alto, label, kind, posicion, showTooltip,
    showEditControl, loading, dim, separacion, visible, modo,
  ]);

  return (
    <Marker
      ref={marcador}
      coordinate={coordinate}
      // En Google Maps Android las polilíneas y los marcadores son capas
      // separadas; un z-index explícito mantiene el pin visible sobre la ruta.
      zIndex={zIndex ?? 10}
      anchor={calcularAnclajePin(medidas.alto, posicion)}
      accessibilityLabel={label}
      title={!visible ? label : undefined}
      onPress={onPress}>
      <View
        // Fabric no debe aplanar este contenedor: Android mide el primer hijo
        // nativo para dimensionar el bitmap completo (texto, Editar y círculo).
        collapsable={false}
        style={[styles.wrap, posicion === 'abajo' && styles.wrapAbajo]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setMedidas((actuales) => actuales.ancho === width && actuales.alto === height
            ? actuales
            : { ancho: width, alto: height });
        }}>
        <View
          style={[
            styles.etiquetas,
            posicion === 'abajo' && styles.wrapAbajo,
            {
              opacity: visible ? 1 : 0,
              marginTop: tieneEtiquetas && posicion === 'abajo' ? separacion : 0,
              marginBottom: tieneEtiquetas && posicion === 'arriba' ? separacion : 0,
            },
          ]}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setMedidasEtiquetas((actuales) => actuales.ancho === width && actuales.alto === height
              ? actuales : { ancho: width, alto: height });
          }}>
          {showEditControl && (
            <View
              style={[
                styles.editControl,
                kind === 'A' ? styles.editOrigin : styles.editDestination,
              ]}>
              <Ionicons name="create" size={11} color={colors.textOnPrimary} />
              <Text style={styles.editText}>Editar</Text>
            </View>
          )}
          {showTooltip && (
            <View style={styles.tooltip}>
              <Text
                numberOfLines={2}
                ellipsizeMode="tail"
                style={styles.tooltipText}>
                {label}
              </Text>
            </View>
          )}
        </View>
        <View
          style={[styles.pinBase, kind === 'A' ? styles.pinA : styles.pinB, dim && styles.pinDim]}>
          <Text style={[styles.pinLabel, loading && styles.pinLabelLoading]}>{kind}</Text>
          <View style={styles.pinLoader} pointerEvents="none">
            <PinLoadingIndicator loading={loading} color={colors.textOnPrimary} compact />
          </View>
        </View>
      </View>
    </Marker>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  wrap: { alignItems: 'center' },
  etiquetas: { alignItems: 'center', gap: spacing.sm },
  wrapAbajo: { flexDirection: 'column-reverse' },
  editControl: {
    width: 56,
    height: 22,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 2,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  editOrigin: { backgroundColor: colors.primary },
  editDestination: { backgroundColor: colors.danger },
  editText: { color: colors.textOnPrimary, fontSize: 9, fontWeight: fontWeight.bold },
  tooltip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  tooltipText: {
    maxWidth: 160,
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  pinBase: {
    width: TAMANO_PIN_RUTA,
    height: TAMANO_PIN_RUTA,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDE_PIN_RUTA,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pinA: { backgroundColor: colors.primary },
  pinB: { backgroundColor: colors.danger },
  pinDim: { opacity: 0.5 },
  pinLabel: {
    color: colors.textOnPrimary,
    fontSize: TAMANO_LETRA_PIN_RUTA,
    fontWeight: fontWeight.bold,
    // Centra la letra dentro del círculo compacto también en Android.
    includeFontPadding: false,
    lineHeight: TAMANO_PIN_RUTA - BORDE_PIN_RUTA * 2,
    textAlign: 'center',
  },
  pinLabelLoading: { opacity: 0 },
  pinLoader: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
