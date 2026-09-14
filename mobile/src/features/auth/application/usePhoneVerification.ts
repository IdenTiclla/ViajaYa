import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { env } from '@/core/config/env';
import { createPhoneVerificationRepository } from '../data/phoneVerificationRepository';
import type { PhoneChallenge } from '../domain/phoneVerification';
import { createPhoneVerificationController } from './phoneVerificationController';

export function usePhoneVerification(
  phone: string, deviceId: string, purpose: PhoneChallenge['purpose'] = 'sign_in',
) {
  const controller = useMemo(
    () => createPhoneVerificationController(createPhoneVerificationRepository(purpose), env), [purpose],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    controller.reset();
    return () => controller.reset();
  }, [controller, phone, deviceId]);
  return { state, controller };
}
