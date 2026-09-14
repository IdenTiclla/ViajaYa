import { PhoneVerificationError } from '../domain/phoneVerification';
import type {
  PhoneChallenge, PhoneVerificationProof, PhoneVerificationRepository,
} from '../domain/phoneVerification';

type State = {
  phase: 'idle' | 'requesting' | 'waiting' | 'code' | 'verifying' | 'verified';
  challenge: PhoneChallenge | null;
  code: string;
  error: string | null;
  resendAt: number;
  verifyAt: number;
  proof: PhoneVerificationProof | null;
};

type Policy = {
  appEnv: 'development' | 'testing' | 'production';
  otpMode: 'mock' | 'provider';
  otpTestAutofill: boolean;
};

const initialState = (): State => ({
  phase: 'idle', challenge: null, code: '', error: null, resendAt: 0, verifyAt: 0, proof: null,
});

export function createPhoneVerificationController(
  repository: PhoneVerificationRepository, policy: Policy, clock: () => number = Date.now,
) {
  let state = initialState();
  let generation = 0;
  let pending: AbortController | null = null;
  const listeners = new Set<() => void>();
  const simulated = policy.appEnv !== 'production' && policy.otpMode === 'mock';
  const publish = (next: State) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const fail = (error: unknown, operation: 'request' | 'verify') => {
    const retry = error instanceof PhoneVerificationError ? error.retryAfterSeconds : 0;
    const requesting = operation === 'request';
    const challenge = state.challenge && Date.parse(state.challenge.expiresAt) > clock()
      ? state.challenge : null;
    publish({ ...state, challenge, code: challenge ? state.code : '',
      phase: challenge ? 'code' : requesting && retry > 0 ? 'waiting' : 'idle',
      error: requesting && retry > 0 ? null : error instanceof PhoneVerificationError
        ? error.message : 'No pudimos conectar. Vuelve a intentarlo.',
      resendAt: requesting ? Math.max(state.resendAt, clock() + retry * 1000) : state.resendAt,
      verifyAt: requesting ? state.verifyAt : clock() + retry * 1000,
    });
  };

  async function request(phone: string, deviceId: string) {
    if (pending || clock() < state.resendAt || state.phase === 'verified') return;
    const current = ++generation;
    const abort = new AbortController();
    pending = abort;
    // A rejected resend does not invalidate the challenge already delivered to the user.
    publish({ ...state, phase: 'requesting', error: null });
    try {
      const result = await repository.request(phone, deviceId, abort.signal);
      if (current !== generation) return;
      const { testCode, ...challenge } = result;
      const code = simulated && policy.otpTestAutofill && /^[0-9]{6}$/.test(testCode ?? '')
        ? testCode! : '';
      publish({ ...state, phase: 'code', challenge, code,
        resendAt: clock() + result.resendAfterSeconds * 1000 });
    } catch (error) {
      if (current === generation) fail(error, 'request');
    } finally {
      if (current === generation) pending = null;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    simulated,
    setCode(code: string) {
      if (state.phase !== 'code') return;
      publish({ ...state, code: code.replace(/[^0-9]/g, '').slice(0, 6), error: null });
    },
    reset() {
      generation += 1;
      pending?.abort();
      pending = null;
      publish(initialState());
    },
    request,
    async retryRequest(phone: string, deviceId: string) {
      if (state.phase === 'waiting') await request(phone, deviceId);
    },
    async verify(deviceId: string) {
      if (pending || state.phase !== 'code' || !state.challenge || clock() < state.verifyAt) return;
      if (Date.parse(state.challenge.expiresAt) <= clock()) {
        publish({ ...state, error: 'El código venció. Solicita uno nuevo.' });
        return;
      }
      if (!/^[0-9]{6}$/.test(state.code)) {
        publish({ ...state, error: 'Ingresa los seis dígitos del código.' });
        return;
      }
      const current = ++generation;
      const abort = new AbortController();
      pending = abort;
      const { challenge, code } = state;
      publish({ ...state, phase: 'verifying', error: null });
      try {
        const proof = await repository.verify(challenge, code, deviceId, abort.signal);
        if (current === generation) {
          publish({ ...state, phase: 'verified', code: '', challenge: null, proof });
        }
      } catch (error) {
        if (current === generation) fail(error, 'verify');
      } finally {
        if (current === generation) pending = null;
      }
    },
  };
}
