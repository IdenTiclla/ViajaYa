import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { AxiosError } from 'axios';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/core/config/env' || specifier === '@/core/http/tokenStorage') {
      return { url: `phone-test:${specifier}`, shortCircuit: true };
    }
    if (specifier === '@/core/http/client') {
      return { url: new URL('../src/core/http/client.ts', import.meta.url).href, shortCircuit: true };
    }
    if (specifier.endsWith('/domain/phoneVerification')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'phone-test:@/core/config/env') {
      return { format: 'module', shortCircuit: true, source: `
        export const env = { appEnv: 'testing', otpMode: 'mock',
          apiUrl: 'https://testing.example.test/api/v1' };
      ` };
    }
    if (url === 'phone-test:@/core/http/tokenStorage') {
      return { format: 'module', shortCircuit: true, source: `
        export const tokenStorage = { async get() {
          return { accessToken: 'old-access', refreshToken: 'old-refresh' };
        }, async save() {}, async clear() {} };
      ` };
    }
    return nextLoad(url, context);
  },
});
const { phoneVerificationRepository } = await import(
  '../src/features/auth/data/phoneVerificationRepository.ts'
);
const { api } = await import('@/core/http/client');
const { env } = await import('@/core/config/env');
hooks.deregister();

const challengeDto = {
  challenge_id: 'challenge-1', phone: '+59171234567', purpose: 'sign_in',
  expires_at: '2026-09-10T05:10:00Z', resend_after_seconds: 60, test_code: '001234',
};

test('phone requests use the common HTTP client and map both sides of the contract', async (t) => {
  const adapter = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = adapter; });
  const requests = [];
  api.defaults.adapter = async (config) => {
    requests.push(config);
    assert.equal(config.skipAuth, true);
    assert.equal(config.headers.get('Authorization'), undefined);
    assert.equal(config.headers.get('X-App-Environment'), 'testing');
    return { status: 200, statusText: 'OK', config, headers: {},
      data: config.url.endsWith('/verify')
        ? { verification_token: 'proof-only', expires_at: '2026-09-10T05:10:00Z' }
        : challengeDto };
  };
  const signal = new AbortController().signal;
  const challenge = await phoneVerificationRepository.request('+59171234567', 'device-1', signal);
  assert.equal(challenge.challengeId, 'challenge-1');
  assert.equal(challenge.testCode, '001234');
  assert.deepEqual(JSON.parse(requests[0].data), {
    phone: '+59171234567', device_id: 'device-1', purpose: 'sign_in',
  });
  const proof = await phoneVerificationRepository.verify(challenge, '001234', 'device-1', signal);
  assert.equal(proof.verificationToken, 'proof-only');
  assert.deepEqual(JSON.parse(requests[1].data), {
    challenge_id: 'challenge-1', phone: '+59171234567', purpose: 'sign_in',
    code: '001234', device_id: 'device-1',
  });
  assert.equal(requests[1].signal, signal);
});

test('production discards a test code even if the server sends one', async (t) => {
  const adapter = api.defaults.adapter;
  const previousEnvironment = env.appEnv;
  const previousMode = env.otpMode;
  t.after(() => {
    api.defaults.adapter = adapter;
    env.appEnv = previousEnvironment;
    env.otpMode = previousMode;
  });
  env.appEnv = 'production';
  env.otpMode = 'provider';
  api.defaults.adapter = async (config) => ({
    status: 201, statusText: 'Created', config, headers: {}, data: challengeDto,
  });
  const challenge = await phoneVerificationRepository.request(
    '+59171234567', 'device-1', new AbortController().signal,
  );
  assert.equal(challenge.testCode, undefined);
});

test('Retry-After reaches the form without trying to refresh an authentication session', async (t) => {
  const adapter = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = adapter; });
  let requests = 0;
  api.defaults.adapter = async (config) => {
    requests += 1;
    throw new AxiosError('limited', 'ERR_BAD_REQUEST', config, null, {
      status: 429, statusText: 'Too Many Requests', config,
      headers: { 'retry-after': '90' }, data: { detail: 'Espera antes de volver a intentarlo.' },
    });
  };
  await assert.rejects(phoneVerificationRepository.request(
    '+59171234567', 'device-1', new AbortController().signal,
  ), (error) => error.retryAfterSeconds === 90);
  assert.equal(requests, 1);
});
