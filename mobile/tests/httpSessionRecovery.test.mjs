import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import axios, { AxiosError } from 'axios';

// Replaces only the native storage and the Expo configuration.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/core/config/env' || specifier === '@/core/http/tokenStorage') {
      return { url: `prueba:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'prueba:@/core/config/env') {
      return { format: 'module', shortCircuit: true,
        source: 'export const env = { appEnv: "development", apiUrl: "https://api.example.test/api/v1" };' };
    }
    if (url === 'prueba:@/core/http/tokenStorage') {
      return { format: 'module', shortCircuit: true, source: `
        export const tokenStorage = {
          tokens: null,
          async get() { return this.tokens; },
          async prepareRefresh() { return this.get(); },
          async save(tokens) { this.tokens = tokens; },
          async clear() { this.tokens = null; },
        };
      ` };
    }
    return nextLoad(url, context);
  },
});
const { api, setOnSessionExpired, invalidateSessionRequests } = await import('../src/core/http/client.ts');
const { tokenStorage } = await import('@/core/http/tokenStorage');
hooks.deregister();

test('authentication requests always declare their build environment', async (t) => {
  const originalAdapter = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = originalAdapter; });
  api.defaults.adapter = async (config) => {
    assert.equal(config.headers.get('X-App-Environment'), 'development');
    return { status: 200, statusText: 'OK', headers: {}, config, data: {} };
  };
  await api.post('/auth/phone/challenges', {}, {
    skipAuth: true,
    headers: { 'X-App-Environment': 'production' },
  });
});

function unauthorized(config) {
  return new AxiosError('Session expired', 'ERR_BAD_REQUEST', config, null, {
    data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config,
  });
}

test('an old session does not leave recovery waiting on an unbounded refresh', async (t) => {
  const adapter = api.defaults.adapter;
  const globalAdapter = axios.defaults.adapter;
  const timeout = api.defaults.timeout;
  t.after(() => {
    api.defaults.adapter = adapter;
    axios.defaults.adapter = globalAdapter;
    api.defaults.timeout = timeout;
    setOnSessionExpired(null);
  });
  assert.equal(timeout, 15_000);
  api.defaults.timeout = 20;
  tokenStorage.tokens = { accessToken: 'vencido', refreshToken: 'anterior' };
  let refreshTimeout;
  let expired = 0;
  setOnSessionExpired(() => { expired += 1; });
  const simulate = async (config) => {
    if (!config.url.endsWith('/auth/refresh')) throw unauthorized(config);
    refreshTimeout = config.timeout;
    // Simulates the transport with no response; only a configured timeout releases it.
    return new Promise((_, reject) => {
      if (config.timeout > 0) {
        setTimeout(() => reject(new AxiosError('Tiempo agotado', 'ECONNABORTED', config)),
          config.timeout);
      }
    });
  };
  api.defaults.adapter = simulate;
  axios.defaults.adapter = simulate;
  const result = await Promise.race([
    api.get('/rides/me/active').then(() => 'success', () => 'error'),
    new Promise((resolve) => setTimeout(() => resolve('bloqueado'), 150)),
  ]);
  assert.equal(result, 'error');
  assert.equal(refreshTimeout, 20);
  assert.equal(expired, 0);
  assert.equal(tokenStorage.tokens.refreshToken, 'anterior');
});

test('concurrent queries share the refresh and recover a start without a ride', async (t) => {
  const adapter = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = adapter; });
  tokenStorage.tokens = { accessToken: 'vencido', refreshToken: 'anterior' };
  let refreshes = 0;
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/refresh') {
      refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: { access_token: 'nuevo', refresh_token: 'renovado' },
        status: 200, statusText: 'OK', headers: {}, config };
    }
    if (config.headers.Authorization !== 'Bearer nuevo') throw unauthorized(config);
    return { data: null, status: 200, statusText: 'OK', headers: {}, config };
  };
  const responses = await Promise.all([
    api.get('/rides/me/active'), api.get('/rides/me/pending-rating'),
  ]);
  assert.deepEqual(responses.map(({ data }) => data), [null, null]);
  assert.equal(refreshes, 1);
  assert.equal(tokenStorage.tokens.accessToken, 'nuevo');
});

test('an expired refresh signs out without renewing recursively', async (t) => {
  const adapter = api.defaults.adapter;
  t.after(() => {
    api.defaults.adapter = adapter;
    setOnSessionExpired(null);
  });
  tokenStorage.tokens = { accessToken: 'vencido', refreshToken: 'also expired' };
  let requests = 0;
  let expired = 0;
  setOnSessionExpired(() => { expired += 1; });
  api.defaults.adapter = async (config) => {
    requests += 1;
    assert.ok(requests <= 2, 'The renewal entered a loop');
    throw unauthorized(config);
  };
  await assert.rejects(api.get('/rides/me/active'));
  assert.equal(requests, 2);
  assert.equal(expired, 1);
  assert.equal(tokenStorage.tokens, null);
});

test('a failed read during the refresh does not block future renewals', async (t) => {
  const adapter = api.defaults.adapter;
  const get = tokenStorage.get;
  t.after(() => { api.defaults.adapter = adapter; tokenStorage.get = get; });
  tokenStorage.tokens = { accessToken: 'vencido', refreshToken: 'anterior' };
  let reads = 0;
  tokenStorage.get = async () => {
    reads += 1;
    if (reads === 2) throw new Error('Almacenamiento temporalmente inaccesible');
    return tokenStorage.tokens;
  };
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/refresh') {
      return { data: { access_token: 'nuevo', refresh_token: 'renovado' },
        status: 200, statusText: 'OK', headers: {}, config };
    }
    if (config.headers.Authorization !== 'Bearer nuevo') throw unauthorized(config);
    return { data: null, status: 200, statusText: 'OK', headers: {}, config };
  };
  await assert.rejects(api.get('/rides/me/active'), /Almacenamiento/);
  assert.equal((await api.get('/rides/me/active')).status, 200);
});

test('a rejected renewed token goes back to login instead of repeating recovery', async (t) => {
  const adapter = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = adapter; setOnSessionExpired(null); });
  tokenStorage.tokens = { accessToken: 'linux', refreshToken: 'linux-refresh' };
  let requestLog = 0;
  let expirations = 0;
  setOnSessionExpired(() => { expirations += 1; });
  api.defaults.adapter = async (config) => {
    requestLog += 1;
    if (config.url === '/auth/refresh') return {
      data: { access_token: 'renovado', refresh_token: 'renovado-refresh' },
      status: 200, statusText: 'OK', headers: {}, config,
    };
    throw unauthorized(config);
  };
  await assert.rejects(api.get('/auth/me'));
  assert.equal(requestLog, 3);
  assert.equal(expirations, 1);
  assert.equal(tokenStorage.tokens, null);
});

test('going back to login discards an earlier renewal that answers late', async (t) => {
  const adapter = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = adapter; });
  tokenStorage.tokens = { accessToken: 'anterior', refreshToken: 'anterior-refresh' };
  let release;
  let notifyStart;
  const started = new Promise((resolve) => { notifyStart = resolve; });
  api.defaults.adapter = async (config) => {
    if (config.url !== '/auth/refresh') throw unauthorized(config);
    return new Promise((resolve) => {
      release = () => resolve({ data: { access_token: 'late', refresh_token: 'late' },
        status: 200, statusText: 'OK', headers: {}, config });
      notifyStart();
    });
  };
  const pending = assert.rejects(api.get('/auth/me'));
  await started;
  invalidateSessionRequests();
  tokenStorage.tokens = { accessToken: 'otra-cuenta', refreshToken: 'otra-cuenta' };
  release();
  await pending;
  assert.equal(tokenStorage.tokens.accessToken, 'otra-cuenta');
});
