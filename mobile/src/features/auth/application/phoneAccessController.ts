/** Keep account completion retryable and discard work from abandoned entry attempts. */
import type { PhoneAccessRepository, PhoneCapabilities, PhoneCompletion } from '../domain/phoneAccess';
import type { PhoneVerificationProof } from '../domain/phoneVerification';
import type { AuthResult } from '../domain/types';

export type EntryMode = 'sign_in' | 'legacy' | 'recovery' | 'recovery_complete';
type State = {
  step: 'loading' | 'phone' | 'code' | 'profile' | 'legacy' | 'recovery' | 'case' | 'complete';
  mode: EntryMode;
  capabilities: PhoneCapabilities | null;
  deviceId: string;
  phone: string;
  busy: boolean;
  error: string | null;
  caseId: string | null;
};

export function createPhoneAccessController(dependencies: {
  repository: PhoneAccessRepository;
  installationId: () => Promise<string>;
  randomId: () => string;
  deviceName: string;
  acceptSession: (result: AuthResult) => Promise<void>;
  errorMessage: (error: unknown) => string;
}) {
  let state: State = { step: 'loading', mode: 'sign_in', capabilities: null,
    deviceId: '', phone: '', busy: false, error: null, caseId: null };
  const listeners = new Set<() => void>();
  let generation = 0;
  let pending: AbortController | null = null;
  let completion: PhoneCompletion | null = null;
  const publish = (values: Partial<State>) => {
    state = { ...state, ...values };
    listeners.forEach((listener) => listener());
  };
  const cancel = () => { generation += 1; pending?.abort(); pending = null; };
  async function run(operation: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (state.busy) return;
    cancel();
    const current = generation;
    pending = new AbortController();
    publish({ busy: true, error: null });
    try {
      await operation(pending.signal, () => current === generation);
    } catch (error) {
      if (current === generation) publish({ error: dependencies.errorMessage(error) });
    } finally {
      if (current === generation) publish({ busy: false });
    }
  }
  async function complete(extra: Partial<PhoneCompletion> = {}) {
    if (!completion) return;
    const payload = { ...completion, ...extra };
    await run(async (signal, current) => {
      const result = await dependencies.repository.complete(payload, signal);
      if (!current()) return;
      if (!result) { publish({ step: 'profile' }); return; }
      await dependencies.acceptSession(result);
      if (current()) publish({ step: 'complete' });
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { cancel(); publish({ busy: false }); },
    async initialize() {
      await run(async (signal, current) => {
        const [capabilities, deviceId] = await Promise.all([
          dependencies.repository.capabilities(signal), dependencies.installationId(),
        ]);
        if (current()) publish({ step: 'phone', capabilities, deviceId });
      });
    },
    start(phone: string, mode: EntryMode) {
      cancel(); completion = null;
      publish({ phone, mode, step: 'code', busy: false, error: null, caseId: null });
    },
    back() {
      cancel(); completion = null;
      publish({ step: 'phone', busy: false, error: null });
    },
    async verified(proof: PhoneVerificationProof) {
      completion = { phone: state.phone, verificationToken: proof.verificationToken,
        deviceId: state.deviceId, deviceName: dependencies.deviceName, requestId: dependencies.randomId() };
      if (state.mode === 'legacy') { publish({ step: 'legacy' }); return; }
      if (state.mode.startsWith('recovery')) { publish({ step: 'recovery' }); return; }
      publish({ step: 'complete' });
      await complete();
    },
    complete,
    async requestRecovery(accountHint: string, reason: string) {
      if (!completion) return;
      const payload = { ...completion, accountHint, reason };
      await run(async (signal, current) => {
        const caseId = await dependencies.repository.requestRecovery(payload, signal);
        if (current()) publish({ caseId, step: 'case' });
      });
    },
    async completeRecovery(caseId: string) {
      if (!completion) return;
      const payload = { ...completion, caseId };
      await run(async (signal, current) => {
        const result = await dependencies.repository.completeRecovery(payload, signal);
        if (!current()) return;
        await dependencies.acceptSession(result);
        if (current()) publish({ step: 'complete' });
      });
    },
  };
}
