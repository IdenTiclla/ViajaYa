import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

/** Bloquea el botón físico atrás mientras un flujo debe cerrarse explícitamente. */
export function useBlockHardwareBack(enabled: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => subscription.remove();
    }, [enabled]),
  );
}
