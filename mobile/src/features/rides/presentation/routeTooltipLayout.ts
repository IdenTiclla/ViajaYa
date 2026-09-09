import type { Coordinates } from '@/core/domain/geo';

export type PosicionTooltip = 'arriba' | 'abajo';
// Una sola escala visual para todos los mapas, sin variantes por rol o pantalla.
// Medidas lógicas: react-native-maps aplica la densidad nativa de cada dispositivo.
export const ANCHO_RUTA = 3;
export const ANCHO_CONTORNO_RUTA = 5;
export const TAMANO_PIN_RUTA = 16;
export const BORDE_PIN_RUTA = 1.5;
export const TAMANO_LETRA_PIN_RUTA = 9;
export const MARGEN_TOOLTIP_RUTA = 96;
export const MARGEN_TOOLTIP_EDITABLE = 126;
export const SEPARACION_TOOLTIP = 8;
const SEPARACION_MAXIMA_TOOLTIP = 48;
const HOLGURA_RUTA = ANCHO_CONTORNO_RUTA / 2 + 4;

export type PuntoMapa = { x: number; y: number };
type MedidasEtiqueta = { ancho: number; alto: number };

/** Proyección cenital de Google Maps en unidades lógicas, relativa al pin. */
export function proyectarRutaRespectoAlPin(
  punto: Coordinates,
  ruta: readonly Coordinates[],
  rumboMapa: number,
  zoomMapa: number,
): PuntoMapa[] {
  const escala = 256 * 2 ** zoomMapa;
  const mercator = (latitud: number) => {
    const radianes = Math.max(-85, Math.min(85, latitud)) * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + radianes / 2)) / (2 * Math.PI);
  };
  const origenY = mercator(punto.latitude);
  const rumbo = rumboMapa * Math.PI / 180;
  return ruta.map((coordenada) => {
    const longitud = ((coordenada.longitude - punto.longitude + 540) % 360) - 180;
    const este = longitud / 360 * escala;
    const norte = (mercator(coordenada.latitude) - origenY) * escala;
    return {
      x: este * Math.cos(rumbo) - norte * Math.sin(rumbo),
      y: -norte * Math.cos(rumbo) - este * Math.sin(rumbo),
    };
  });
}

/** Busca espacio para toda la etiqueta, incluyendo Editar, frente a cada tramo. */
export function ubicarTooltipSinCruzarRuta(
  ruta: readonly PuntoMapa[],
  medidas: MedidasEtiqueta,
  preferida: PosicionTooltip,
): { posicion: PosicionTooltip; separacion: number; visible: boolean } {
  const radio = TAMANO_PIN_RUTA / 2;
  const limiteX = medidas.ancho / 2 + HOLGURA_RUTA;
  const ocupados: [number, number][] = [];
  for (let i = 1; i < ruta.length; i += 1) {
    const a = ruta[i - 1];
    const b = ruta[i];
    // Recorta el segmento contra la franja horizontal del tooltip: comprobar
    // solo vértices omitiría una calle larga que cruza por detrás del texto.
    const dx = b.x - a.x;
    let inicio = 0;
    let fin = 1;
    if (Math.abs(dx) < 0.000001) {
      if (Math.abs(a.x) > limiteX) continue;
    } else {
      const t1 = (-limiteX - a.x) / dx;
      const t2 = (limiteX - a.x) / dx;
      inicio = Math.max(0, Math.min(t1, t2));
      fin = Math.min(1, Math.max(t1, t2));
      if (inicio > fin) continue;
    }
    const y1 = a.y + (b.y - a.y) * inicio;
    const y2 = a.y + (b.y - a.y) * fin;
    ocupados.push([Math.min(y1, y2) - HOLGURA_RUTA, Math.max(y1, y2) + HOLGURA_RUTA]);
  }

  const separacionLibre = (posicion: PosicionTooltip) => {
    const intervalos = ocupados.map(([min, max]): [number, number] =>
      posicion === 'arriba' ? [-max, -min] : [min, max],
    ).sort((a, b) => a[0] - b[0]);
    let borde = radio + SEPARACION_TOOLTIP;
    for (const [inicio, fin] of intervalos) {
      if (fin < borde) continue;
      if (inicio > borde + medidas.alto) break;
      borde = fin + 1;
    }
    return borde - radio;
  };
  const opuesta = preferida === 'arriba' ? 'abajo' : 'arriba';
  const principal = separacionLibre(preferida);
  const alternativa = separacionLibre(opuesta);
  const posicion = principal <= alternativa ? preferida : opuesta;
  const separacion = Math.min(principal, alternativa);
  // Con un zoom demasiado lejano puede no caber ninguna etiqueta. Priorizamos
  // la ruta y dejamos su título nativo disponible al tocar A/B; nunca creamos
  // un bitmap gigante ni colocamos texto encima del trayecto como fallback.
  return separacion <= SEPARACION_MAXIMA_TOOLTIP
    ? { posicion, separacion, visible: true }
    : { posicion: preferida, separacion: SEPARACION_TOOLTIP, visible: false };
}

/** Coloca el texto al lado opuesto del tramo que entra o sale del punto. */
export function elegirPosicionTooltip(
  kind: 'A' | 'B',
  punto: Coordinates,
  ruta: readonly Coordinates[],
  rumboMapa = 0,
): PosicionTooltip {
  const preferida = kind === 'A' ? 'arriba' : 'abajo';
  const cosLatitud = Math.cos(punto.latitude * Math.PI / 180);
  const rumbo = rumboMapa * Math.PI / 180;
  let este = 0;
  let norte = 0;
  // Omite duplicados y el pequeño ajuste del proveedor a la calle. Usar el
  // extremo opuesto fallaría en rutas que primero doblan en otra dirección.
  for (let i = 0; i < ruta.length; i += 1) {
    const vecino = ruta[kind === 'A' ? i : ruta.length - 1 - i];
    este = (vecino.longitude - punto.longitude) * cosLatitud;
    norte = vecino.latitude - punto.latitude;
    if (Math.hypot(este, norte) >= 0.0001) break;
  }
  const longitud = Math.hypot(este, norte);
  if (longitud === 0) return preferida;
  // El rumbo de la cámara también cuenta: tras girar el mapa, norte geográfico
  // ya no coincide con arriba de la pantalla. Un tramo horizontal usa el lado
  // estable de cada letra para que las etiquetas no oscilen por redondeo.
  const haciaArriba = norte * Math.cos(rumbo) + este * Math.sin(rumbo);
  if (Math.abs(haciaArriba) < longitud * 0.1) return preferida;
  return haciaArriba > 0 ? 'abajo' : 'arriba';
}

/** Mantiene el centro del símbolo sobre la coordenada, incluso con varias líneas. */
export function calcularAnclajePin(altura: number, posicion: PosicionTooltip) {
  const alturaReal = Math.max(altura, TAMANO_PIN_RUTA);
  const centroPin = posicion === 'arriba'
    ? alturaReal - TAMANO_PIN_RUTA / 2
    : TAMANO_PIN_RUTA / 2;
  return { x: 0.5, y: centroPin / alturaReal };
}

/** Da margen al layout nativo antes de regenerar el bitmap de Google Maps. */
export function programarRedibujadoMarcador(
  redibujar: () => void,
  pedirFrame = requestAnimationFrame,
  cancelarFrame = cancelAnimationFrame,
): () => void {
  let cancelado = false;
  let frame = pedirFrame(() => {
    if (cancelado) return;
    frame = pedirFrame(() => {
      if (!cancelado) redibujar();
    });
  });
  return () => {
    cancelado = true;
    cancelarFrame(frame);
  };
}
