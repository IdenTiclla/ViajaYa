import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['react-native', '@/core/config/env'].includes(specifier)) {
      return { url: `native-social:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'native-social:react-native') return { format: 'module', shortCircuit: true, source: `
      export const Platform = { OS: 'android' };
      export const NativeModules = {};
      export const TurboModuleRegistry = { get(name) { return NativeModules[name] ?? null; } };
    ` };
    if (url === 'native-social:@/core/config/env') return { format: 'module', shortCircuit: true, source: `
      export const env = { googleClientIds: { web: 'web-client', ios: '' },
        facebookAppId: '123', facebookClientToken: 'public-client-token' };
    ` };
    return nextLoad(url, context);
  },
});
const { nativeSocialAvailable, requestNativeSocialCredential } = await import(
  '../src/features/auth/data/nativeSocialAuth.ts'
);
const { NativeModules, Platform } = await import('react-native');
hooks.deregister();

test('existing development builds keep phone access usable without loading missing native SDKs', async () => {
  assert.equal(nativeSocialAvailable('google'), false);
  assert.equal(nativeSocialAvailable('facebook'), false);
  await assert.rejects(requestNativeSocialCredential('google'), /versión actualizada/);
  await assert.rejects(requestNativeSocialCredential('facebook'), /versión actualizada/);
});

test('Android providers need the matching compiled modules; iOS Facebook stays gated', () => {
  Object.assign(NativeModules, {
    RNGoogleSignin: {}, FBLoginManager: {}, FBAccessToken: {}, FBSettings: {},
  });
  assert.equal(nativeSocialAvailable('google'), true);
  assert.equal(nativeSocialAvailable('facebook'), true);
  Platform.OS = 'ios';
  assert.equal(nativeSocialAvailable('facebook'), false);
  assert.equal(nativeSocialAvailable('google'), false);
});
