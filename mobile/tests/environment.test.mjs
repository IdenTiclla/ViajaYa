import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parseRuntimeEnvironment,
  resolveBuildEnvironment,
} from '../src/core/config/environment.js';

const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const environments = ['development', 'testing', 'production'];
const variables = {
  API_URL: 'http://192.168.1.10:8000/api/v1',
  TESTING_API_URL: 'https://api-testing.example.test/api/v1',
  PRODUCTION_API_URL: 'https://api.example.test/api/v1',
};

test('EAS profiles select three distinct native identities and update channels', () => {
  const identities = Object.entries(eas.build).map(([profile, config]) => {
    const build = resolveBuildEnvironment({ ...variables, ...config.env, EAS_BUILD_PROFILE: profile });
    assert.equal(config.channel, build.appEnv);
    return build;
  });
  for (const key of ['appId', 'scheme', 'name', 'apiUrl']) {
    assert.equal(new Set(identities.map((identity) => identity[key])).size, 3, key);
  }
  assert.equal(identities.find((identity) => identity.appEnv === 'production').appId, 'com.viajaya.app');
});

for (const appEnv of environments) {
  test(`${appEnv} build configuration is accepted by the runtime`, () => {
    const build = resolveBuildEnvironment({ ...variables, APP_ENV: appEnv });
    const runtime = parseRuntimeEnvironment(build);
    assert.equal(runtime.appEnv, appEnv);
    assert.equal(runtime.otpMode, appEnv === 'production' ? 'provider' : 'mock');
    assert.equal(runtime.otpTestAutofill, appEnv !== 'production');
  });
}

test('hosted builds never inherit local API or provider configuration', () => {
  for (const appEnv of ['testing', 'production']) {
    assert.throws(() => resolveBuildEnvironment({ APP_ENV: appEnv, API_URL: variables.API_URL }));
    const build = resolveBuildEnvironment({ ...variables, APP_ENV: appEnv, GOOGLE_MAPS_API_KEY_ANDROID: 'local-only' });
    assert.equal(build.googleMapsApiKey, '');
  }
});

test('public configuration never serializes backend secrets', () => {
  const build = resolveBuildEnvironment({
    ...variables, APP_ENV: 'production', JWT_SECRET: 'server-secret', FACEBOOK_APP_SECRET: 'server-secret',
    PRODUCTION_OTP_PROVIDER_API_KEY: 'server-secret', PRODUCTION_GOOGLE_MAPS_API_KEY_ANDROID: 'public-mobile-key',
  });
  assert.equal(JSON.stringify(build).includes('server-secret'), false);
  assert.equal(build.googleMapsApiKey, 'public-mobile-key');
});

test('Facebook public client tokens stay inside their selected build environment', () => {
  const values = { ...variables, FACEBOOK_CLIENT_TOKEN: 'development-token',
    TESTING_FACEBOOK_CLIENT_TOKEN: 'testing-token', PRODUCTION_FACEBOOK_CLIENT_TOKEN: 'production-token' };
  for (const appEnv of environments) {
    assert.equal(resolveBuildEnvironment({ ...values, APP_ENV: appEnv }).facebookClientToken, `${appEnv}-token`);
  }
});

for (const invalidUrl of [
  'http://api.example.test/api/v1', 'https://localhost/api/v1', 'https://127.0.0.1/api/v1',
  'https://[::1]/api/v1', 'https://2130706433/api/v1', 'https://api.local/api/v1',
  'https://user:secret@api.example.test/api/v1', 'https://api.example.test/api/v1?token=secret',
  'https://api.example.test/api/v1#fragment', 'https://api.example.test/wrong-path',
]) {
  test(`production rejects unsafe API destination: ${invalidUrl}`, () => {
    assert.throws(() => resolveBuildEnvironment({ APP_ENV: 'production', PRODUCTION_API_URL: invalidUrl }));
  });
}

test('a release profile cannot silently use a development identity', () => {
  assert.throws(() => resolveBuildEnvironment({ ...variables, EAS_BUILD_PROFILE: 'production' }));
  assert.throws(() => resolveBuildEnvironment({ ...variables, APP_ENV: 'testing', EAS_BUILD_PROFILE: 'production' }));
  assert.throws(() => resolveBuildEnvironment({ APP_ENV: 'staging' }));
});

test('production rejects test autofill during build and at runtime', () => {
  assert.throws(() => resolveBuildEnvironment({ ...variables, APP_ENV: 'production', PRODUCTION_OTP_TEST_AUTOFILL: 'true' }));
  const build = resolveBuildEnvironment({ ...variables, APP_ENV: 'production' });
  assert.throws(() => parseRuntimeEnvironment({ ...build, otpMode: 'mock' }));
  assert.throws(() => parseRuntimeEnvironment({ ...build, otpTestAutofill: true }));
  assert.throws(() => parseRuntimeEnvironment({ ...build, appEnv: 'testing' }));
  assert.throws(() => parseRuntimeEnvironment({}));
});

test('lower environments can test incorrect OTP without external verification', () => {
  const build = resolveBuildEnvironment({ ...variables, APP_ENV: 'testing', TESTING_OTP_TEST_AUTOFILL: 'false' });
  assert.equal(build.otpMode, 'mock');
  assert.equal(parseRuntimeEnvironment(build).otpTestAutofill, false);
});
