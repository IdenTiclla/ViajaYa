/**
 * Every Spanish string of the location gate, banner and waiting chip.
 *
 * Rule: name the cause and the one action that fixes it. This is the only file where
 * the banner sentence «No pudimos ubicarte…» may live (the copy guard test allows it here).
 */
import type { BlockingGateKind, LocationBannerCause, LocationRole } from './gateState';

export type GatePlatform = 'android' | 'ios';

/** Text with bold fragments, e.g. «Toca **Abrir ajustes**». */
export type RichText = { text: string; bold?: boolean }[];

export type GateBenefit = { icon: 'locate' | 'car' | 'lock'; text: string };

export type GateContent = {
  title: string;
  body: string;
  benefits?: GateBenefit[];
  /** Explanation under the benefits, above the button (primer). */
  caption?: string;
  card?: { tone: 'danger' | 'warning'; text: RichText };
  steps?: RichText[];
  cta: string;
  /** Only the passenger can leave the gate. */
  secondary?: string;
};

export const GATE_DISMISS_LABEL = 'Ahora no';

function plain(text: string): RichText {
  return [{ text }];
}

export function gateContent(
  kind: BlockingGateKind,
  role: LocationRole,
  platform: GatePlatform,
): GateContent {
  const secondary = role === 'passenger' ? GATE_DISMISS_LABEL : undefined;
  const driver = role === 'driver';

  switch (kind) {
    case 'primer':
      return {
        title: 'Activa tu ubicación',
        body: driver
          ? 'Para mostrarte las solicitudes cercanas y compartir tu posición con tu pasajero, ViajaYa necesita saber dónde estás.'
          : 'Para mostrarte el mapa y los conductores cercanos, ViajaYa necesita saber dónde estás.',
        benefits: driver
          ? [
            { icon: 'car', text: 'Ves las solicitudes que tienes cerca' },
            { icon: 'locate', text: 'Tu pasajero te sigue hasta el punto de recogida' },
            { icon: 'lock', text: 'Solo la usamos mientras trabajas con la app' },
          ]
          : [
            { icon: 'locate', text: 'Te ubicamos como punto de recogida' },
            { icon: 'car', text: 'Ves los conductores que tienes cerca' },
            { icon: 'lock', text: 'Solo la usamos mientras usas la app' },
          ],
        caption: 'El sistema te pedirá confirmar. Elige «Mientras usas la app».',
        cta: 'Permitir ubicación',
        secondary,
      };
    case 'denied':
      return {
        title: 'Sin ubicación no hay mapa',
        body: driver
          ? 'No diste permiso de ubicación, así que no podemos mostrarte solicitudes cerca de ti.'
          : 'No diste permiso de ubicación, así que no podemos mostrarte el mapa ni pedir un viaje desde donde estás.',
        card: {
          tone: 'danger',
          text: plain(
            'Puedes activarla ahora. Solo toma un toque y la usamos únicamente mientras tengas la app abierta.',
          ),
        },
        cta: 'Permitir ubicación',
        secondary,
      };
    case 'blocked':
      return {
        title: 'Actívala desde Ajustes',
        body: 'Tu teléfono ya no nos deja volver a preguntar. Solo tú puedes activarla, en tres pasos:',
        steps: platform === 'ios'
          ? [
            [{ text: 'Toca ' }, { text: 'Abrir ajustes', bold: true }],
            [{ text: 'Entra en ' }, { text: 'Ubicación', bold: true }],
            [{ text: 'Elige ' }, { text: 'Mientras se usa la app', bold: true }],
          ]
          : [
            [{ text: 'Toca ' }, { text: 'Abrir ajustes', bold: true }],
            [{ text: 'Entra en ' }, { text: 'Permisos › Ubicación', bold: true }],
            [{ text: 'Elige ' }, { text: 'Permitir mientras se usa la app', bold: true }],
          ],
        cta: 'Abrir ajustes',
        secondary,
      };
    case 'services-off':
      return {
        title: 'Enciende el GPS',
        body: driver
          ? 'Ya diste permiso, pero la ubicación de tu teléfono está apagada. Enciéndela para ver solicitudes cerca de ti.'
          : 'Ya diste permiso, pero la ubicación de tu teléfono está apagada. Enciéndela para ver el mapa y encontrar conductores.',
        card: {
          tone: 'warning',
          text: platform === 'ios'
            ? [
              { text: 'Ve a ' },
              { text: 'Ajustes › Privacidad y seguridad › Localización', bold: true },
              { text: ' y activa ' },
              { text: 'Servicios de localización', bold: true },
              { text: '.' },
            ]
            : [
              { text: 'Desliza el panel de tu teléfono desde arriba y activa ' },
              { text: 'Ubicación', bold: true },
              { text: '.' },
            ],
        },
        cta: 'Activar GPS',
        secondary,
      };
  }
}

/** Driver on a device that cannot locate at all (informational, not fixable). */
export const UNSUPPORTED_CONTENT = {
  title: 'Este dispositivo no puede conducir',
  body: 'El modo conductor necesita la ubicación del teléfono para mostrarte solicitudes y compartir tu posición con el pasajero. Puedes seguir usando ViajaYa como pasajero.',
  cta: 'Volver al modo pasajero',
} as const;

export function bannerText(cause: LocationBannerCause): string {
  switch (cause) {
    case 'services-off':
      return 'No pudimos ubicarte. Toca para encender la ubicación.';
    case 'permission-denied':
      return 'La ubicación está desactivada. Toca para permitirla.';
    case 'permission-blocked':
      return 'La ubicación está desactivada. Toca para activarla en Ajustes.';
  }
}

export type FixChipPhase = 'locating' | 'weak' | 'estimated';

export function fixChipText(phase: FixChipPhase): string {
  switch (phase) {
    case 'locating':
      return 'Buscando tu ubicación…';
    case 'weak':
      return 'Señal de GPS débil. Sal a un lugar abierto y seguimos buscando.';
    case 'estimated':
      return 'Mostrando tu última ubicación conocida';
  }
}

export const CHIP_PICK_ON_MAP_LABEL = 'Elegir en el mapa';

export type RoutingUnavailableReason = 'permission' | 'services' | 'timeout' | 'imprecise';

/** Why a fresh GPS fix is not available for routing, always with what to do about it. */
export function routingUnavailableMessage(reason: RoutingUnavailableReason): string {
  switch (reason) {
    case 'permission':
      return 'Permite el acceso a tu ubicación para calcular la llegada.';
    case 'services':
      return 'Enciende la ubicación del teléfono para calcular la llegada.';
    case 'timeout':
      return 'Todavía estamos buscando tu ubicación. Espera unos segundos para calcular la llegada.';
    case 'imprecise':
      return 'Tu señal de GPS todavía es imprecisa. Espera a que mejore para calcular la llegada.';
  }
}
