/** Verify Expo's resolved output, with optional native generation in isolated copies. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = process.argv.includes('--native');
const social = process.argv.includes('--social');
const reportRoot = resolve(root, '../local-files/phase01');
const profiles = [
  ['development', 'development', 'com.viajaya.app.dev', 'viajaya-dev'],
  ['preview', 'testing', 'com.viajaya.app.testing', 'viajaya-testing'],
  ['production', 'production', 'com.viajaya.app', 'viajaya'],
];

function expo(project, args, environment) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/expo/bin/cli'), ...args], {
    cwd: project, env: environment, encoding: 'utf8', timeout: 180_000, maxBuffer: 12 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Verification only supplies synthetic public values and disables dotenv loading.
    throw new Error(`Expo verification failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

for (const [profile, appEnv, appId, scheme] of profiles) {
  const environment = {
    ...process.env,
    CI: '1', EXPO_NO_DOTENV: '1', EXPO_OFFLINE: '1',
    APP_ENV: appEnv, EAS_BUILD_PROFILE: profile,
    API_URL: 'http://127.0.0.1:8000/api/v1',
    TESTING_API_URL: 'https://api-testing.example.test/api/v1',
    PRODUCTION_API_URL: 'https://api.example.test/api/v1',
    OTP_TEST_AUTOFILL: 'true', TESTING_OTP_TEST_AUTOFILL: 'true', PRODUCTION_OTP_TEST_AUTOFILL: 'false',
  };
  // Ignore inherited provider settings so native artifacts never contain real keys.
  for (const key of Object.keys(environment)) {
    if (/GOOGLE_|FACEBOOK_|OTP_PROVIDER_/.test(key)) delete environment[key];
  }
  if (social) {
    const prefix = appEnv === 'development' ? '' : `${appEnv.toUpperCase()}_`;
    Object.assign(environment, {
      [`${prefix}GOOGLE_OAUTH_CLIENT_ID_WEB`]: `123-${appEnv}.apps.googleusercontent.com`,
      [`${prefix}GOOGLE_OAUTH_CLIENT_ID_IOS`]: `456-${appEnv}.apps.googleusercontent.com`,
      [`${prefix}FACEBOOK_APP_ID`]: '123456789000001',
      [`${prefix}FACEBOOK_CLIENT_TOKEN`]: `synthetic-public-client-token-${appEnv}`,
    });
  }
  const config = JSON.parse(expo(root, ['config', '--type', 'public', '--json'], environment));
  assert.equal(config.android.package, appId);
  assert.equal(config.ios.bundleIdentifier, appId);
  assert.equal(config.scheme, scheme);
  assert.equal(config.extra.appEnv, appEnv);
  assert.equal(config.runtimeVersion, `1.0.0-${appEnv}`);
  assert.equal(config.updates.enabled, false);
  assert.equal(config.extra.otpTestAutofill, appEnv !== 'production');

  if (native) {
    mkdirSync(reportRoot, { recursive: true });
    const project = mkdtempSync(join(reportRoot, `android-${appEnv}-`));
    cpSync(root, project, {
      recursive: true,
      filter: (source) => !['node_modules', 'android', 'ios', '.expo', 'dist'].includes(basename(source))
        && !basename(source).startsWith('.env') && !basename(source).endsWith('.log'),
    });
    symlinkSync(join(root, 'node_modules'), join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    expo(project, ['prebuild', '--platform', 'android', '--no-install'], environment);
    const gradle = readFileSync(join(project, 'android/app/build.gradle'), 'utf8');
    const manifest = readFileSync(join(project, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    const strings = readFileSync(join(project, 'android/app/src/main/res/values/strings.xml'), 'utf8');
    assert.ok(gradle.includes(`applicationId '${appId}'`) || gradle.includes(`applicationId "${appId}"`));
    assert.ok(manifest.includes(`android:scheme="${scheme}"`));
    assert.ok(strings.includes(config.name));
    for (const name of ['AutoInitEnabled', 'AutoLogAppEventsEnabled', 'AdvertiserIDCollectionEnabled']) {
      assert.match(manifest, new RegExp(`android:name="com.facebook.sdk.${name}" android:value="false"`));
    }
    if (social) {
      assert.ok(manifest.includes('android:scheme="@string/fb_login_protocol_scheme"'));
      assert.ok(strings.includes('>fb123456789000001</string>'));
      assert.ok(strings.includes(`synthetic-public-client-token-${appEnv}`));
      assert.equal(config.extra.facebookClientToken, `synthetic-public-client-token-${appEnv}`);
    }
    console.log(JSON.stringify({ environment: appEnv, appId, nativeProject: project }));
  } else {
    console.log(JSON.stringify({ environment: appEnv, appId, configuration: 'verified' }));
  }
}
