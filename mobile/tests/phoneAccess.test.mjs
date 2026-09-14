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

test('a sign-up entry sends the captured profile with the first completion', async () => {
  const requests = [];
  const { controller, accepted } = setup({ async complete(payload) {
    requests.push(payload); return { user: { id: 'new-account' }, tokens: {} };
  } });
  await controller.initialize();
  controller.start('+59171234567', 'sign_in', { fullName: 'Test User', termsVersion: 'testing-v1' });
  await controller.verified(proof);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].fullName, 'Test User');
  assert.equal(requests[0].termsVersion, 'testing-v1');
  assert.equal(accepted.length, 1);
  assert.equal(controller.getSnapshot().step, 'complete');
});

test('leaving a sign-up entry drops the captured profile from later sign-ins', async () => {
  const { controller, requests } = setup();
  await controller.initialize();
  controller.start('+59171234567', 'sign_in', { fullName: 'Test User', termsVersion: 'testing-v1' });
  controller.back();
  controller.start('+59171234567', 'sign_in');
  await controller.verified(proof);
  assert.equal(requests[0].fullName, undefined);
  assert.equal(controller.getSnapshot().step, 'profile');
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

test('social onboarding waits for phone proof and explicit linking consent', async () => {
  const { controller, accepted, requests } = setup({ async signInSocial() { return null; } });
  await controller.initialize();
  await controller.signInSocial({ provider: 'google', token: 'provider-proof' });
  assert.equal(controller.getSnapshot().socialProvider, 'google');
  assert.equal(accepted.length, 0);
  controller.start('+59171234567', 'social');
  await controller.verified(proof);
  assert.equal(controller.getSnapshot().step, 'social_confirmation');
  assert.equal(requests.length, 0);
  await controller.complete();
  assert.deepEqual(requests[0].social, { provider: 'google', token: 'provider-proof' });
  assert.equal(controller.getSnapshot().step, 'profile');
  await controller.complete({ fullName: 'New User', termsVersion: 'testing-v1' });
  assert.deepEqual(requests[1].social, requests[0].social);
  assert.equal(requests[1].requestId, requests[0].requestId);
});

test('a linked social identity accepts the managed session returned by the server', async () => {
  const { controller, accepted } = setup({ async signInSocial() {
    return { user: { id: 'existing-driver', role: 'driver' }, tokens: {} };
  } });
  await controller.initialize();
  await controller.signInSocial({ provider: 'facebook', token: 'provider-proof' });
  assert.equal(accepted[0].user.id, 'existing-driver');
  assert.equal(controller.getSnapshot().step, 'complete');
});

test('abandoning social access ignores late sessions and clears the provider proof', async () => {
  let resolve;
  const { controller, accepted, requests } = setup({
    signInSocial: () => new Promise((done) => { resolve = done; }),
  });
  await controller.initialize();
  const pending = controller.signInSocial({ provider: 'google', token: 'abandoned-proof' });
  controller.back(); resolve({ user: { id: 'late' }, tokens: {} }); await pending;
  assert.equal(accepted.length, 0);
  controller.start('+59171234567', 'sign_in');
  await controller.verified(proof);
  assert.equal(requests[0].social, undefined);
});

test('leaving social confirmation never leaks the credential into phone-only or recovery access', async () => {
  const { controller, requests } = setup({ async signInSocial() { return null; } });
  await controller.initialize();
  await controller.signInSocial({ provider: 'google', token: 'abandoned-proof' });
  controller.start('+59171234567', 'social'); await controller.verified(proof);
  controller.back();
  assert.equal(controller.getSnapshot().socialProvider, null);
  controller.start('+59171234567', 'sign_in'); await controller.verified(proof);
  assert.equal(requests[0].social, undefined);
});
