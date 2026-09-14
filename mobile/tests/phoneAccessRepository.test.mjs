import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/core/http/client') return { url: 'social-test:client', shortCircuit: true };
    if (specifier === './mappers') return nextResolve('./mappers.ts', context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'social-test:client') return { format: 'module', shortCircuit: true,
      source: 'export const api = { get() {}, post() {} };' };
    return nextLoad(url, context);
  },
});
const { phoneAccessRepository } = await import('../src/features/auth/data/phoneAccessRepository.ts');
const { api } = await import('@/core/http/client');
hooks.deregister();

test('social access maps provider and installation through the shared client without old auth', async () => {
  const signal = new AbortController().signal;
  api.post = async (url, data, config) => {
    assert.equal(url, '/auth/social/google/sign-in');
    assert.deepEqual(data, { token: 'provider-proof', device_id: 'device-1', device_name: 'Android' });
    assert.deepEqual(config, { skipAuth: true, signal });
    return { data: { status: 'phone_required', auth: null } };
  };
  assert.equal(await phoneAccessRepository.signInSocial(
    { provider: 'google', token: 'provider-proof' }, 'device-1', 'Android', signal,
  ), null);
});

test('confirmed linking carries both proofs without adding password credentials', async () => {
  const signal = new AbortController().signal;
  api.post = async (url, data, config) => {
    assert.equal(url, '/auth/phone/link-social');
    assert.deepEqual(data, {
      phone: '+59171234567', verification_token: 'phone-proof', device_id: 'device-1',
      device_name: 'Android', request_id: 'request-1', full_name: 'Test User', terms_version: 'v1',
      social_provider: 'facebook', social_token: 'provider-proof',
    });
    assert.deepEqual(config, { skipAuth: true, signal });
    return { data: { status: 'profile_required', auth: null } };
  };
  await phoneAccessRepository.complete({
    phone: '+59171234567', verificationToken: 'phone-proof', deviceId: 'device-1',
    deviceName: 'Android', requestId: 'request-1', fullName: 'Test User', termsVersion: 'v1',
    social: { provider: 'facebook', token: 'provider-proof' },
  }, signal);
});

test('older servers without social capabilities keep those methods unavailable', async () => {
  api.get = async () => ({ data: { enabled: true, countries: [], terms_version: 'v1', terms_text: '' } });
  const result = await phoneAccessRepository.capabilities(new AbortController().signal);
  assert.deepEqual(result.socialProviders, []);
});
