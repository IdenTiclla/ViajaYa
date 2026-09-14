/** One phone-access controller per screen: login, sign-up and recovery share the same flow. */
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { useAuthStore } from '@/store/authStore';
import { getInstallationId } from '../data/installationId';
import { phoneAccessRepository } from '../data/phoneAccessRepository';
import { createPhoneAccessController } from './phoneAccessController';

export type AuthController = ReturnType<typeof createPhoneAccessController>;
export type AuthState = ReturnType<AuthController['getSnapshot']>;

export function useAuthController() {
  const controller = useMemo(() => createPhoneAccessController({
    repository: phoneAccessRepository, installationId: getInstallationId,
    randomId: Crypto.randomUUID, deviceName: Platform.OS === 'ios' ? 'iPhone' : 'Android',
    acceptSession: (result) => useAuthStore.getState().acceptPhoneSession(result),
    errorMessage: (error) => getApiErrorMessage(error,
      error instanceof Error ? error.message : 'No pudimos continuar. Vuelve a intentar.'),
  }), []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    void controller.initialize();
    return () => controller.dispose();
  }, [controller]);
  return { controller, state };
}
