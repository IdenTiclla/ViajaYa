import { PhoneVerificationError } from '../domain/phoneVerification';
import type {
  PhoneChallenge, PhoneVerificationProof, PhoneVerificationRepository,
} from '../domain/phoneVerification';

type State = {
  phase: 'idle' | 'requesting' | 'code' | 'verifying' | 'verified';
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
  const fail = (error: unknown, phase: 'idle' | 'code') => {
    const retry = error instanceof PhoneVerificationError ? error.retryAfterSeconds : 0;
    publish({ ...state, phase,
      error: error instanceof PhoneVerificationError
        ? error.message : 'No pudimos conectar. Vuelve a intentarlo.',
      resendAt: Math.max(state.resendAt, clock() + retry * 1000),
      verifyAt: phase === 'code' ? clock() + retry * 1000 : state.verifyAt,
    });
  };

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
    async request(phone: string, deviceId: string) {
      if (pending || clock() < state.resendAt || state.phase === 'verified') return;
      const current = ++generation;
      const abort = new AbortController();
      pending = abort;
      publish({ ...state, phase: 'requesting', challenge: null, code: '', error: null });
      try {
        const result = await repository.request(phone, deviceId, abort.signal);
        if (current !== generation) return;
        const { testCode, ...challenge } = result;
        const code = simulated && policy.otpTestAutofill && /^[0-9]{6}$/.test(testCode ?? '')
          ? testCode! : '';
        publish({ ...state, phase: 'code', challenge, code,
          resendAt: clock() + result.resendAfterSeconds * 1000 });
      } catch (error) {
        if (current === generation) fail(error, 'idle');
      } finally {
        if (current === generation) pending = null;
      }
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
        if (current === generation) fail(error, 'code');
      } finally {
        if (current === generation) pending = null;
      }
    },
  };
}
