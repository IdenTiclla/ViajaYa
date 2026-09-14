/** Proof of a phone check is intentionally distinct from an authenticated session. */
export type PhoneChallenge = {
  challengeId: string;
  phone: string;
  purpose: 'sign_in' | 'recovery' | 'change_phone';
  expiresAt: string;
  resendAfterSeconds: number;
  testCode?: string;
};

export type PhoneVerificationProof = {
  verificationToken: string;
  expiresAt: string;
};

export interface PhoneVerificationRepository {
  request(phone: string, deviceId: string, signal: AbortSignal): Promise<PhoneChallenge>;
  verify(challenge: PhoneChallenge, code: string, deviceId: string,
    signal: AbortSignal): Promise<PhoneVerificationProof>;
}

export class PhoneVerificationError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 0) {
    super(message);
    this.name = 'PhoneVerificationError';
    this.retryAfterSeconds = Math.max(0, retryAfterSeconds);
  }
}
