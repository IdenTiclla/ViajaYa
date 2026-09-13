import { api } from '@/core/http/client';
import type { components } from '@/core/http/generated/openapi';
import type { AccountSession, PhoneAccessRepository, PhoneCompletion } from '../domain/phoneAccess';
import { toAuthResult } from './mappers';

type Schemas = components['schemas'];

function completeDto(payload: PhoneCompletion) {
  return {
    phone: payload.phone, verification_token: payload.verificationToken,
    device_id: payload.deviceId, device_name: payload.deviceName, request_id: payload.requestId,
    full_name: payload.fullName, terms_version: payload.termsVersion,
  };
}

export const phoneAccessRepository: PhoneAccessRepository = {
  async capabilities(signal) {
    const { data } = await api.get<Schemas['PhoneCapabilitiesResponse']>(
      '/auth/phone/capabilities', { skipAuth: true, signal },
    );
    return {
      enabled: data.enabled, termsVersion: data.terms_version, termsText: data.terms_text,
      socialProviders: data.social_providers ?? [],
      countries: data.countries.map((country) => ({
        region: country.region, callingCode: country.calling_code,
      })),
    };
  },
  async complete(payload, signal) {
    const legacy = payload.email !== undefined;
    const social = payload.social;
    const { data } = await api.post<Schemas['PhoneCompleteResponse']>(
      social ? '/auth/phone/link-social' : legacy ? '/auth/phone/link-legacy' : '/auth/phone/complete',
      { ...completeDto(payload), ...(social
        ? { social_provider: social.provider, social_token: social.token }
        : legacy ? { email: payload.email, password: payload.password } : {}) },
      { skipAuth: true, signal },
    );
    if (data.status === 'profile_required') return null;
    if (!data.auth) throw new Error('La respuesta de acceso está incompleta. Vuelve a intentar.');
    return toAuthResult(data.auth);
  },
  async signInSocial(credential, deviceId, deviceName, signal) {
    const { data } = await api.post<Schemas['SocialSignInResponse']>(
      `/auth/social/${credential.provider}/sign-in`,
      { token: credential.token, device_id: deviceId, device_name: deviceName },
      { skipAuth: true, signal },
    );
    if (data.status === 'phone_required') return null;
    if (!data.auth) throw new Error('La respuesta de acceso está incompleta. Vuelve a intentar.');
    return toAuthResult(data.auth);
  },
  async requestRecovery(payload, signal) {
    const { data } = await api.post<Schemas['RecoveryCaseResponse']>('/auth/recovery', {
      verification_token: payload.verificationToken, device_id: payload.deviceId,
      request_id: payload.requestId, account_hint: payload.accountHint, reason: payload.reason,
    }, { skipAuth: true, signal });
    return data.case_id;
  },
  async completeRecovery(payload, signal) {
    const { data } = await api.post<Schemas['PhoneCompleteResponse']>('/auth/recovery/complete', {
      verification_token: payload.verificationToken, device_id: payload.deviceId,
      device_name: payload.deviceName, request_id: payload.requestId, case_id: payload.caseId,
    }, { skipAuth: true, signal });
    if (!data.auth) throw new Error('La recuperación todavía no está disponible.');
    return toAuthResult(data.auth);
  },
};

export const accountSessionsRepository = {
  async list(signal: AbortSignal): Promise<{ managed: boolean; sessions: AccountSession[] }> {
    const { data } = await api.get<Schemas['AccountSessionsResponse']>('/auth/sessions', { signal });
    return { managed: data.managed, sessions: data.sessions.map((session) => ({
      id: session.id, deviceName: session.device_name, current: session.current,
      createdAt: session.created_at, lastSeenAt: session.last_seen_at, expiresAt: session.expires_at,
    })) };
  },
  async revoke(id: string) { await api.delete(`/auth/sessions/${encodeURIComponent(id)}`); },
  async revokeOthers() { await api.delete('/auth/sessions/others'); },
  async changePhone(phone: string, verificationToken: string, deviceId: string) {
    const { data } = await api.post<Schemas['AuthResponse']>('/auth/phone/change', {
      phone, verification_token: verificationToken, device_id: deviceId,
    });
    return toAuthResult(data);
  },
};
