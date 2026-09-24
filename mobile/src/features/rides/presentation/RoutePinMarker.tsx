/**
 * Reusable route marker: circular A (origin) and B (destination) pins
 * and an "Origen"/"Destino" tooltip on the free side of the route. Used by the
 * route views (passenger and driver) so origin and destination always look the same.
 *
 * The tooltip is laid out in flow (not absolute) so it renders reliably inside
 * the marker on iOS and Android; the `anchor` points at the pin (not at the center of
 * the group) so the point sits exactly on the coordinate.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';

import { fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import type { Coordinates } from '@/features/booking/domain/types';
import { InsigniaPuntoMapa } from '@/shared/components/mapa/InsigniaPuntoMapa';
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
  type MedidasEtiqueta,
} from '@/features/rides/presentation/routeTooltipLayout';

type Props = {
  kind: 'A' | 'B';
  coordinate: Coordinates;
  /** Texto del tooltip (p. ej. "Origen", "Destino"). */
  label: string;
  /** Visible route: lets the label move away from the route next to the pin. */
  ruta?: readonly Coordinates[];
  /** Current camera bearing, in degrees. */
  rumboMapa?: number;
  /** Google Maps zoom to compare the text size with the route. */
  zoomMapa?: number;
  /** Hide the tooltip when the information is shown outside the map. */
  showTooltip?: boolean;
  /** Show an edit control attached to the marker. */
  showEditControl?: boolean;
  /** Dim the pin (e.g. unselected origins on the requests map). */
  dim?: boolean;
  /** Marker stacking order when several points overlap. */
  zIndex?: number;
  /** Signals that this point's name is still being resolved. */
  loading?: boolean;
  onPress?: () => void;
  /** Reports the measured label block so the camera can frame it. */
  onLabelSize?: (size: MedidasEtiqueta) => void;
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
  onLabelSize,
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
      // On Google Maps Android polylines and markers are separate
      // layers; an explicit z-index keeps the pin visible above the route.
      zIndex={zIndex ?? 10}
      anchor={calcularAnclajePin(medidas.alto, posicion)}
      accessibilityLabel={label}
      title={!visible ? label : undefined}
      onPress={onPress}>
      <View
        // Fabric must not flatten this container: Android measures the first native
        // child to size the whole bitmap (text, Editar and symbol).
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
            onLabelSize?.({ ancho: width, alto: height });
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
        <InsigniaPuntoMapa
          tipo={kind === 'A' ? 'origen' : 'destino'}
          tamano={TAMANO_PIN_RUTA}
          borde={BORDE_PIN_RUTA}
          tamanoLetra={TAMANO_LETRA_PIN_RUTA}
          cargando={loading}
          atenuado={dim}
        />
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
});
