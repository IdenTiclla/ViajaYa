import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';
import { useReducedMotion } from 'react-native-reanimated';

import type { Coordinates } from '@/core/domain/geo';
import { useEstilos, type Tema } from '@/core/theme';
import { VehiculoMapa } from '@/shared/components/mapa/VehiculoMapa';
import { programarRedibujadoMarcador } from '@/features/rides/presentation/routeTooltipLayout';
import { calcularRotacionVehiculo, esRumboValido } from './rumboVehiculo';

type Props = {
  coordinates: Coordinates;
  heading: number | null;
  tipoVehiculo: 'taxi' | 'moto' | null;
};

/** La posición y la rotación pertenecen al mapa nativo, no a un overlay de pantalla. */
export function MarcadorVehiculo({ coordinates, heading, tipoVehiculo }: Props) {
  const { styles, modo } = useEstilos(crearEstilos);
  const marcador = useRef<MapMarker>(null);
  const orientado = esRumboValido(heading) && tipoVehiculo != null;
  const [rotacion, setRotacion] = useState(esRumboValido(heading) ? heading : 0);
  const anguloVisible = useRef(rotacion);
  const teniaRumbo = useRef(esRumboValido(heading));
  const reducirMovimiento = useReducedMotion();
  useEffect(() => {
    if (!esRumboValido(heading)) { teniaRumbo.current = false; return; }
    const anterior = anguloVisible.current;
    const siguiente = calcularRotacionVehiculo(anterior, heading);
    const duracion = teniaRumbo.current && !reducirMovimiento ? 180 : 0;
    teniaRumbo.current = true;
    let inicio: number | null = null;
    let frame: number;
    const animar = (instante: number) => {
      inicio ??= instante;
      const progreso = duracion ? Math.min(1, (instante - inicio) / duracion) : 1;
      const angulo = anterior + (siguiente - anterior) * (1 - (1 - progreso) ** 3);
      anguloVisible.current = angulo;
      setRotacion(angulo);
      if (progreso < 1) frame = requestAnimationFrame(animar);
    };
    frame = requestAnimationFrame(animar);
    return () => cancelAnimationFrame(frame);
  }, [heading, reducirMovimiento]);
  useEffect(() => programarRedibujadoMarcador(() => marcador.current?.redraw()), [modo, tipoVehiculo, orientado]);

  const etiqueta = orientado
    ? `Tu ${tipoVehiculo === 'moto' ? 'moto' : 'taxi'}`
    : 'Tu ubicación, orientación no disponible';
  // El giro solo cambia una propiedad nativa: conserva el árbol del dibujo.
  const contenido = useMemo(() => (
    <View collapsable={false} style={styles.marco}>
      {/* Ambos slots permanecen montados para mantener estable el bitmap de Fabric. */}
      <View style={[styles.vehiculo, { opacity: orientado ? 1 : 0 }]}>
        <VehiculoMapa tipo={tipoVehiculo ?? 'taxi'} />
        <View style={styles.frente} />
      </View>
      <View style={[styles.sinRumbo, { opacity: orientado ? 0 : 1 }]} />
    </View>
  ), [styles, orientado, tipoVehiculo]);
  return (
    <Marker
      ref={marcador}
      coordinate={coordinates}
      rotation={rotacion}
      flat
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={30}
      title={etiqueta}
      accessibilityLabel={etiqueta}>
      {contenido}
    </Marker>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  marco: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 1,
    borderColor: colors.bordeControl, backgroundColor: colors.vehiculoFondo,
    alignItems: 'center', justifyContent: 'center',
  },
  vehiculo: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  frente: {
    position: 'absolute', top: 1, width: 0, height: 0,
    borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 5,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: colors.vehiculoContorno,
  },
  sinRumbo: {
    position: 'absolute', width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.vehiculoContorno,
  },
});
