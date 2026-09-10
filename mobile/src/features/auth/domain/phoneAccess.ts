import type { AuthResult } from './types';

export type PhoneCapabilities = {
  enabled: boolean;
  countries: { region: string; callingCode: string }[];
  termsVersion: string;
  termsText: string;
};

export type PhoneCompletion = {
  phone: string;
  verificationToken: string;
  deviceId: string;
  deviceName: string;
  requestId: string;
  fullName?: string;
  termsVersion?: string;
  email?: string;
  password?: string;
};

export type AccountSession = {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

export interface PhoneAccessRepository {
  capabilities(signal: AbortSignal): Promise<PhoneCapabilities>;
  complete(payload: PhoneCompletion, signal: AbortSignal): Promise<AuthResult | null>;
  requestRecovery(payload: PhoneCompletion & { accountHint: string; reason: string },
    signal: AbortSignal): Promise<string>;
  completeRecovery(payload: PhoneCompletion & { caseId: string },
    signal: AbortSignal): Promise<AuthResult>;
}
