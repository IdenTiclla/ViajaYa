import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, type MapMarker } from 'react-native-maps';
import { useReducedMotion } from 'react-native-reanimated';

import type { Coordinates } from '@/core/domain/geo';
import { useEstilos, type Tema } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';
import { VehiculoMapa } from '@/shared/components/mapa/VehiculoMapa';
import { programarRedibujadoMarcador } from '@/features/rides/presentation/routeTooltipLayout';
import { calcularRotacionVehiculo, esRumboValido } from './rumboVehiculo';

type Props = {
  label?: string;
  opacity?: number;
  coordinates: Coordinates;
  heading: number | null;
  tipoVehiculo: VehicleType | null;
};

/** La posición y la rotación pertenecen al mapa nativo, no a un overlay de pantalla. */
export function MarcadorVehiculo({ coordinates, heading, tipoVehiculo, label, opacity = 1 }: Props) {
  const { styles, modo } = useEstilos(crearEstilos);
  const marcador = useRef<MapMarker>(null);
  const orientado = esRumboValido(heading) && tipoVehiculo != null;
  const hasVehicle = tipoVehiculo != null;
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
      <View style={[styles.vehiculo, { opacity: hasVehicle ? 1 : 0 }]}>
        <VehiculoMapa tipo={tipoVehiculo ?? 'taxi'} />
        <View style={[styles.frente, { opacity: orientado ? 1 : 0 }]} />
      </View>
      <View style={[styles.sinRumbo, { opacity: hasVehicle ? 0 : 1 }]} />
    </View>
  ), [styles, orientado, hasVehicle, tipoVehiculo]);
  return (
    <Marker
      ref={marcador}
      coordinate={coordinates}
      rotation={rotacion}
      flat
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={30}
      opacity={opacity}
      title={label ?? etiqueta}
      accessibilityLabel={label ?? etiqueta}>
      {contenido}
    </Marker>
  );
}

// Compact marker: the vehicle drawing sits directly on the street, no background disc.
const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  marco: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  vehiculo: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  frente: {
    position: 'absolute', top: 0, width: 0, height: 0,
    borderLeftWidth: 3, borderRightWidth: 3, borderBottomWidth: 4,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: colors.vehiculoContorno,
  },
  sinRumbo: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7, borderWidth: 2.5,
    borderColor: colors.vehiculoReflejo, backgroundColor: colors.vehiculoContorno,
  },
});
