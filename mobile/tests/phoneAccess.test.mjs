import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhoneAccessController } from '../src/features/auth/application/phoneAccessController.ts';

function setup(changes = {}) {
  const accepted = [];
  const requests = [];
  const repository = {
    async capabilities() { return { enabled: true, countries: [{ region: 'BO', callingCode: '+591' }],
      termsVersion: 'testing-v1', termsText: 'Test terms' }; },
    async complete(payload) { requests.push(payload); return null; },
    async requestRecovery() { return 'case-1'; },
    async completeRecovery() { return { user: { id: 'old-account' }, tokens: {} }; },
    ...changes,
  };
  const controller = createPhoneAccessController({ repository, installationId: async () => 'device-1',
    randomId: () => 'request-1', deviceName: 'Test Android',
    acceptSession: async (result) => { accepted.push(result); }, errorMessage: (error) => error.message });
  return { controller, accepted, requests };
}
const proof = { verificationToken: 'proof', expiresAt: new Date(Date.now() + 300_000).toISOString() };

test('a verified new phone asks for profile without creating a local session', async () => {
  const { controller, accepted, requests } = setup();
  await controller.initialize(); controller.start('+59171234567', 'sign_in');
  await controller.verified(proof);
  assert.equal(controller.getSnapshot().step, 'profile');
  assert.equal(accepted.length, 0);
  await controller.complete({ fullName: 'Test User', termsVersion: 'testing-v1' });
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(requests[1].termsVersion, 'testing-v1');
});

test('a lost completion response retries with the same proof and request identity', async () => {
  const requests = [];
  const { controller, accepted } = setup({ async complete(payload) {
    requests.push(payload);
    if (requests.length === 1) throw new Error('Connection lost');
    return { user: { id: 'existing' }, tokens: {} };
  } });
  await controller.initialize(); controller.start('+59171234567', 'sign_in');
  await controller.verified(proof);
  assert.equal(controller.getSnapshot().error, 'Connection lost');
  await controller.complete();
  assert.deepEqual(requests[0], requests[1]); assert.equal(accepted.length, 1);
});

test('leaving the entry flow ignores a late account response', async () => {
  let resolve;
  const { controller, accepted } = setup({ complete: () => new Promise((done) => { resolve = done; }) });
  await controller.initialize(); controller.start('+59171234567', 'sign_in');
  const pending = controller.verified(proof);
  controller.back(); resolve({ user: { id: 'late' }, tokens: {} }); await pending;
  assert.equal(accepted.length, 0); assert.equal(controller.getSnapshot().step, 'phone');
});

test('legacy entry waits for explicit credentials after OTP', async () => {
  const { controller, requests } = setup();
  await controller.initialize(); controller.start('+59171234567', 'legacy');
  await controller.verified(proof);
  assert.equal(controller.getSnapshot().step, 'legacy'); assert.equal(requests.length, 0);
  await controller.complete({ email: 'old@example.test', password: 'legacy-secret' });
  assert.equal(requests[0].email, 'old@example.test');
});

test('a recovery request reports its case and never issues a local session', async () => {
  const { controller, accepted } = setup();
  await controller.initialize(); controller.start('+59171234567', 'recovery');
  await controller.verified(proof); await controller.requestRecovery('old-number', 'lost phone access');
  assert.equal(controller.getSnapshot().caseId, 'case-1'); assert.equal(accepted.length, 0);
  controller.back(); assert.equal(controller.getSnapshot().step, 'phone');
});

test('a failed installation read can be retried without leaving a loading loop', async () => {
  const { controller } = setup({ async capabilities() { throw new Error('Unavailable'); } });
  await controller.initialize();
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().error, 'Unavailable');
  await controller.initialize(); assert.equal(controller.getSnapshot().busy, false);
});
