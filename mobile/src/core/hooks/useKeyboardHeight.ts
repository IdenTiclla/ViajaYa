/**
 * Altura actual del teclado (0 si está oculto).
 *
 * Útil para subir manualmente paneles anclados al borde inferior: con
 * edge-to-edge (Android, SDK 56) el teclado no reacomoda el layout, así que el
 * contenido fijo al fondo queda tapado y hay que desplazarlo nosotros.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
