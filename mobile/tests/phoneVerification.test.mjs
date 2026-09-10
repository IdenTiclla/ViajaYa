import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/domain/phoneVerification')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { createPhoneVerificationController } = await import(
  '../src/features/auth/application/phoneVerificationController.ts'
);
const { PhoneVerificationError } = await import('../src/features/auth/domain/phoneVerification.ts');
hooks.deregister();

const policy = { appEnv: 'testing', otpMode: 'mock', otpTestAutofill: true };
const phone = '+59171234567';
const device = '84911e87-9189-45fc-919f-47fe0c2fe8cf';

function fixture(overrides = {}, configuration = policy) {
  let now = Date.parse('2026-09-10T05:00:00Z');
  let requests = 0;
  let verifications = 0;
  const repository = {
    async request() {
      requests += 1;
      return { challengeId: `challenge-${requests}`, phone, purpose: 'sign_in',
        expiresAt: new Date(now + 300_000).toISOString(), resendAfterSeconds: 60,
        testCode: '098765' };
    },
    async verify(challenge, code, submittedDevice) {
      verifications += 1;
      assert.equal(challenge.phone, phone);
      assert.equal(code, '098765');
      assert.equal(submittedDevice, device);
      return { verificationToken: 'one-use-proof', expiresAt: new Date(now + 300_000).toISOString() };
    },
    ...overrides,
  };
  const controller = createPhoneVerificationController(repository, configuration, () => now);
  return { controller, advance(ms) { now += ms; },
    counts: () => ({ requests, verifications }) };
}

test('autofill waits for Continue and returns a proof instead of authenticating', async () => {
  const { controller, counts } = fixture();
  await controller.request(phone, device);
  assert.equal(controller.getSnapshot().code, '098765');
  assert.equal(controller.getSnapshot().phase, 'code');
  assert.equal(controller.getSnapshot().challenge.testCode, undefined);
  assert.equal(counts().verifications, 0);
  await controller.verify(device);
  assert.equal(controller.getSnapshot().phase, 'verified');
  assert.equal(controller.getSnapshot().proof.verificationToken, 'one-use-proof');
  assert.equal(controller.getSnapshot().proof.accessToken, undefined);
  assert.equal(controller.getSnapshot().code, '');
  await controller.verify(device);
  assert.equal(counts().verifications, 1);
});

for (const configuration of [
  { ...policy, otpTestAutofill: false },
  { appEnv: 'production', otpMode: 'provider', otpTestAutofill: true },
]) {
  test(`autofill is suppressed for ${JSON.stringify(configuration)}`, async () => {
    const { controller } = fixture({}, configuration);
    await controller.request(phone, device);
    assert.equal(controller.getSnapshot().code, '');
    assert.equal(controller.getSnapshot().challenge.testCode, undefined);
    if (configuration.appEnv === 'production') assert.equal(controller.simulated, false);
    controller.setCode('09 8765');
    assert.equal(controller.getSnapshot().code, '098765');
  });
}

test('resend is bounded by server time and replaces the previous challenge', async () => {
  const { controller, advance, counts } = fixture();
  await controller.request(phone, device);
  await controller.request(phone, device);
  assert.equal(counts().requests, 1);
  advance(60_000);
  await controller.request(phone, device);
  assert.equal(counts().requests, 2);
  assert.equal(controller.getSnapshot().challenge.challengeId, 'challenge-2');
});

test('an expired code after backgrounding requires another request', async () => {
  const { controller, advance, counts } = fixture();
  await controller.request(phone, device);
  advance(301_000);
  await controller.verify(device);
  assert.match(controller.getSnapshot().error, /venció/);
  assert.equal(counts().verifications, 0);
  await controller.request(phone, device);
  await controller.verify(device);
  assert.equal(counts().verifications, 1);
});

test('incorrect codes keep the form editable and allow recovery', async () => {
  let attempts = 0;
  const { controller } = fixture({
    async verify() {
      attempts += 1;
      if (attempts === 1) throw new PhoneVerificationError('Código inválido o vencido.');
      return { verificationToken: 'proof', expiresAt: '2026-09-10T05:10:00Z' };
    },
  });
  await controller.request(phone, device);
  controller.setCode('123456');
  await controller.verify(device);
  assert.equal(controller.getSnapshot().phase, 'code');
  assert.match(controller.getSnapshot().error, /inválido/);
  controller.setCode('098765');
  await controller.verify(device);
  assert.equal(controller.getSnapshot().phase, 'verified');
});

test('network errors leave a retry path and respect Retry-After', async () => {
  let calls = 0;
  const { controller, advance } = fixture({
    async request() {
      calls += 1;
      throw new PhoneVerificationError('Espera antes de volver a intentarlo.', 90);
    },
  });
  await controller.request(phone, device);
  assert.equal(controller.getSnapshot().phase, 'idle');
  await controller.request(phone, device);
  assert.equal(calls, 1);
  advance(90_000);
  await controller.request(phone, device);
  assert.equal(calls, 2);
});

test('changing phone cancels the request and ignores a late response', async () => {
  let complete;
  let signal;
  const { controller } = fixture({
    request(_phone, _device, requestSignal) {
      signal = requestSignal;
      return new Promise((resolve) => { complete = resolve; });
    },
  });
  const pending = controller.request(phone, device);
  controller.reset();
  assert.equal(signal.aborted, true);
  complete({ challengeId: 'old', phone, purpose: 'sign_in',
    expiresAt: '2026-09-10T05:10:00Z', resendAfterSeconds: 60, testCode: '123456' });
  await pending;
  assert.equal(controller.getSnapshot().phase, 'idle');
  assert.equal(controller.getSnapshot().code, '');
  assert.equal(controller.getSnapshot().challenge, null);
});

test('verification honors the server cooldown before accepting another tap', async () => {
  let calls = 0;
  const { controller, advance } = fixture({
    async verify() {
      calls += 1;
      throw new PhoneVerificationError('Espera antes de volver a intentarlo.', 30);
    },
  });
  await controller.request(phone, device);
  await controller.verify(device);
  await controller.verify(device);
  assert.equal(calls, 1);
  advance(30_000);
  await controller.verify(device);
  assert.equal(calls, 2);
});

test('leaving during verification cannot deliver a late proof', async () => {
  let complete;
  const { controller } = fixture({
    verify() { return new Promise((resolve) => { complete = resolve; }); },
  });
  await controller.request(phone, device);
  const pending = controller.verify(device);
  controller.reset();
  complete({ verificationToken: 'late-proof', expiresAt: '2026-09-10T05:10:00Z' });
  await pending;
  assert.equal(controller.getSnapshot().proof, null);
  assert.equal(controller.getSnapshot().phase, 'idle');
});

test('concurrent taps issue only one request', async () => {
  let calls = 0;
  let complete;
  const { controller } = fixture({
    request() {
      calls += 1;
      return new Promise((resolve) => { complete = resolve; });
    },
  });
  const first = controller.request(phone, device);
  await controller.request(phone, device);
  assert.equal(calls, 1);
  complete({ challengeId: 'one', phone, purpose: 'sign_in',
    expiresAt: '2026-09-10T05:10:00Z', resendAfterSeconds: 60 });
  await first;
  assert.equal(controller.getSnapshot().phase, 'code');
});
