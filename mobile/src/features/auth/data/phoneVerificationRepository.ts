import { isAxiosError } from 'axios';

import { env } from '@/core/config/env';
import { api } from '@/core/http/client';
import type { components } from '@/core/http/generated/openapi';
import { PhoneVerificationError } from '../domain/phoneVerification';
import type { PhoneChallenge, PhoneVerificationRepository } from '../domain/phoneVerification';

type ChallengeDto = components['schemas']['TestPhoneChallengeResponse'];
type ProofDto = components['schemas']['PhoneVerificationResponse'];

function translateError(error: unknown): never {
  if (isAxiosError(error)) {
    const body: unknown = error.response?.data;
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    const retry = Number(error.response?.headers?.['retry-after'] ?? 0);
    throw new PhoneVerificationError(
      typeof detail === 'string' ? detail : 'No pudimos conectar. Vuelve a intentarlo.',
      Number.isFinite(retry) ? retry : 0,
    );
  }
  throw new PhoneVerificationError('No pudimos completar la verificación. Vuelve a intentarlo.');
}

export function createPhoneVerificationRepository(
  purpose: PhoneChallenge['purpose'] = 'sign_in',
): PhoneVerificationRepository {
  const prefix = purpose === 'change_phone' ? '/auth/phone/change' : '/auth/phone';
  const skipAuth = purpose !== 'change_phone';
  return {
  async request(phone, deviceId, signal) {
    try {
      const { data } = await api.post<ChallengeDto>(`${prefix}/challenges`, {
        phone, device_id: deviceId, purpose,
      }, { skipAuth, signal });
      return {
        challengeId: data.challenge_id, phone: data.phone, purpose: data.purpose,
        expiresAt: data.expires_at, resendAfterSeconds: data.resend_after_seconds,
        testCode: env.appEnv !== 'production' && env.otpMode === 'mock'
          ? data.test_code ?? undefined : undefined,
      };
    } catch (error) {
      return translateError(error);
    }
  },
  async verify(challenge, code, deviceId, signal) {
    try {
      const { data } = await api.post<ProofDto>(`${prefix}/verify`, {
        challenge_id: challenge.challengeId, phone: challenge.phone,
        purpose: challenge.purpose, code, device_id: deviceId,
      }, { skipAuth, signal });
      return { verificationToken: data.verification_token, expiresAt: data.expires_at };
    } catch (error) {
      return translateError(error);
    }
  },
  };
}

export const phoneVerificationRepository = createPhoneVerificationRepository();
