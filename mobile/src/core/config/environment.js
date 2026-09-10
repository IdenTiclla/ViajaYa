/** Pure configuration rules shared by Expo builds and the mobile runtime. */
const APP_ENVIRONMENTS = ['development', 'testing', 'production'];
const BUILD_PROFILES = { development: 'development', preview: 'testing', production: 'production' };
const APP_IDENTITIES = {
  development: { appId: 'com.viajaya.app.dev', scheme: 'viajaya-dev', name: 'ViajaYa Desarrollo' },
  testing: { appId: 'com.viajaya.app.testing', scheme: 'viajaya-testing', name: 'ViajaYa Pruebas' },
  production: { appId: 'com.viajaya.app', scheme: 'viajaya', name: 'ViajaYa' },
};

function parseAppEnvironment(value) {
  if (!APP_ENVIRONMENTS.includes(value)) {
    throw new Error('APP_ENV must be development, testing, or production.');
  }
  return value;
}

function parseApiUrl(value, appEnv) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('API_URL must be a valid URL.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const local = ['localhost', '0.0.0.0', '[::]', '[::1]', 'host.docker.internal'].includes(host)
    || /^127\./.test(host) || host.endsWith('.localhost') || host.endsWith('.local');
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || url.pathname.replace(/\/$/, '') !== '/api/v1') {
    throw new Error('API_URL must end in /api/v1 without credentials, query, or fragment.');
  }
  if (appEnv !== 'development' && (url.protocol !== 'https:' || local)) {
    throw new Error('Testing and production require a hosted HTTPS API.');
  }
  return url.toString().replace(/\/$/, '');
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('OTP_TEST_AUTOFILL must be true or false.');
}

function resolveBuildEnvironment(variables) {
  const appEnv = parseAppEnvironment(variables.APP_ENV ?? 'development');
  const profile = variables.EAS_BUILD_PROFILE;
  if (profile && BUILD_PROFILES[profile] !== appEnv) {
    throw new Error('EAS_BUILD_PROFILE and APP_ENV must identify the same environment.');
  }
  // Hosted builds never reuse unprefixed local API or provider credentials.
  const prefix = appEnv === 'development' ? '' : `${appEnv.toUpperCase()}_`;
  const read = (key) => variables[`${prefix}${key}`] ?? '';
  const apiUrl = parseApiUrl(read('API_URL') || (appEnv === 'development'
    ? 'http://localhost:8000/api/v1' : ''), appEnv);
  const otpTestAutofill = parseBoolean(read('OTP_TEST_AUTOFILL'), appEnv !== 'production');
  if (appEnv === 'production' && otpTestAutofill) {
    throw new Error('Production cannot enable OTP test autofill.');
  }
  return {
    appEnv,
    ...APP_IDENTITIES[appEnv],
    apiUrl,
    otpMode: appEnv === 'production' ? 'provider' : 'mock',
    otpTestAutofill,
    googleMapsApiKeyAndroid: read('GOOGLE_MAPS_API_KEY_ANDROID'),
    googleMapsApiKeyIos: read('GOOGLE_MAPS_API_KEY_IOS'),
    googleMapsApiKey: read('GOOGLE_MAPS_API_KEY_ANDROID') || read('GOOGLE_MAPS_API_KEY_IOS'),
    googleClientIds: {
      ios: read('GOOGLE_OAUTH_CLIENT_ID_IOS'),
      android: read('GOOGLE_OAUTH_CLIENT_ID_ANDROID'),
      web: read('GOOGLE_OAUTH_CLIENT_ID_WEB'),
    },
    facebookAppId: read('FACEBOOK_APP_ID'),
  };
}

function parseRuntimeEnvironment(extra) {
  const appEnv = parseAppEnvironment(extra.appEnv);
  const identity = APP_IDENTITIES[appEnv];
  if (extra.appId !== identity.appId || extra.scheme !== identity.scheme) {
    throw new Error('The app identity does not match its runtime environment.');
  }
  const expectedOtpMode = appEnv === 'production' ? 'provider' : 'mock';
  if (extra.otpMode !== expectedOtpMode || typeof extra.otpTestAutofill !== 'boolean'
    || (appEnv === 'production' && extra.otpTestAutofill)) {
    throw new Error('OTP configuration does not match the runtime environment.');
  }
  return {
    appEnv,
    ...identity,
    apiUrl: parseApiUrl(extra.apiUrl, appEnv),
    otpMode: expectedOtpMode,
    otpTestAutofill: extra.otpTestAutofill,
  };
}

module.exports = { parseAppEnvironment, parseApiUrl, resolveBuildEnvironment, parseRuntimeEnvironment };
