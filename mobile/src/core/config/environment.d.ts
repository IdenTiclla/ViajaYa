export type AppEnvironment = 'development' | 'testing' | 'production';
export type OtpMode = 'mock' | 'provider';

export type RuntimeEnvironment = {
  appEnv: AppEnvironment;
  appId: string;
  name: string;
  scheme: string;
  apiUrl: string;
  otpMode: OtpMode;
  otpTestAutofill: boolean;
};

export type BuildEnvironment = RuntimeEnvironment & {
  googleMapsApiKeyAndroid: string;
  googleMapsApiKeyIos: string;
  googleMapsApiKey: string;
  googleClientIds: { ios: string; android: string; web: string };
  facebookAppId: string;
};

export function parseAppEnvironment(value: unknown): AppEnvironment;
export function parseApiUrl(value: unknown, appEnv: AppEnvironment): string;
export function resolveBuildEnvironment(variables: Record<string, string | undefined>): BuildEnvironment;
export function parseRuntimeEnvironment(extra: Record<string, unknown>): RuntimeEnvironment;
