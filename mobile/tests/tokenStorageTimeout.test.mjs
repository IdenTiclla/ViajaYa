import assert from 'node:assert/strict';
import test from 'node:test';
import { createSecureSessionStorage } from '../src/core/http/secureSessionStorage.ts';

function setup() {
  const values = new Map();
  const native = {
    async getItemAsync(key) { return values.get(key) ?? null; },
    async setItemAsync(key, value) { values.set(key, value); },
    async deleteItemAsync(key) { values.delete(key); },
  };
  let sequence = 0;
  const storage = createSecureSessionStorage(native, () => `request-${++sequence}`, 15);
  return { values, native, storage };
}

test('a blocked native read times out and a later read can recover', async () => {
  const { native, storage } = setup();
  native.getItemAsync = () => new Promise(() => {});
  await assert.rejects(storage.get(), /No pudimos leer tu sesión/);
  native.getItemAsync = async (key) => key.endsWith('.v2') ? null : 'recovered';
  assert.deepEqual(await storage.get(), { accessToken: 'recovered', refreshToken: 'recovered' });
});

test('incomplete legacy credentials do not restore a session', async () => {
  const { values, storage } = setup();
  values.set('viajaya.accessToken', 'old');
  assert.equal(await storage.get(), null);
});

test('a blocked native clear is bounded and immediately hides credentials in memory', async () => {
  const { native, storage } = setup();
  await storage.save({ accessToken: 'access', refreshToken: 'refresh' });
  native.setItemAsync = () => new Promise(() => {});
  await assert.rejects(storage.clear(), /eliminar la sesión/);
  assert.equal(await storage.get(), null);
});

test('refresh preparation migrates legacy tokens atomically and retains the retry identity', async () => {
  const { values, storage } = setup();
  values.set('viajaya.accessToken', 'a'); values.set('viajaya.refreshToken', 'r');
  const first = await storage.prepareRefresh();
  assert.equal(first.refreshRequestId, 'request-1');
  assert.deepEqual(await storage.prepareRefresh(), first);
  await storage.save({ accessToken: 'b', refreshToken: 's' });
  assert.equal((await storage.prepareRefresh()).refreshRequestId, 'request-2');
});

test('a late save cannot resurrect a session after logout, including on process restart', async () => {
  const { values, native, storage } = setup();
  let release;
  const originalWrite = native.setItemAsync;
  native.setItemAsync = async (key, value) => {
    if (value !== 'null') await new Promise((resolve) => { release = resolve; });
    await originalWrite(key, value);
  };
  const save = storage.save({ accessToken: 'old', refreshToken: 'old-refresh' });
  await Promise.resolve();
  const clear = storage.clear();
  release();
  await Promise.all([save, clear]);
  assert.equal(await storage.get(), null);
  values.set('viajaya.accessToken', 'stale'); values.set('viajaya.refreshToken', 'stale');
  const restarted = createSecureSessionStorage(native, () => 'unused', 15);
  assert.equal(await restarted.get(), null);
});

test('invalid stored JSON fails with an actionable error instead of restoring partial tokens', async () => {
  const { values, storage } = setup();
  values.set('viajaya.session.v2', JSON.stringify({ accessToken: 'a' }));
  await assert.rejects(storage.get(), /incompleta/);
});
