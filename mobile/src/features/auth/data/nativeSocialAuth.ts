/** Load native providers only after checking that the installed build contains them. */
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { env } from '@/core/config/env';
import type { SocialCredential, SocialProvider } from '../domain/phoneAccess';

export function nativeSocialAvailable(provider: SocialProvider): boolean {
  if (provider === 'google') {
    return Boolean(env.googleClientIds.web && (Platform.OS !== 'ios' || env.googleClientIds.ios)
      && TurboModuleRegistry.get('RNGoogleSignin'));
  }
  // iOS Limited Login needs a separate nonce-bound OIDC verifier before enabling it.
  return Platform.OS === 'android' && Boolean(env.facebookAppId && env.facebookClientToken
    && NativeModules.FBLoginManager && NativeModules.FBAccessToken && NativeModules.FBSettings);
}

export async function requestNativeSocialCredential(
  provider: SocialProvider,
): Promise<SocialCredential | null> {
  if (!nativeSocialAvailable(provider)) {
    throw new Error('Este acceso necesita una versión actualizada de la app.');
  }
  if (provider === 'google') {
    const { GoogleSignin, isSuccessResponse } = await import('@react-native-google-signin/google-signin');
    GoogleSignin.configure({ webClientId: env.googleClientIds.web,
      ...(env.googleClientIds.ios ? { iosClientId: env.googleClientIds.ios } : {}) });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    if (!isSuccessResponse(result)) return null;
    if (!result.data.idToken) throw new Error('Google no entregó la verificación. Vuelve a intentar.');
    return { provider, token: result.data.idToken };
  }
  const { AccessToken, LoginManager, Settings } = await import('react-native-fbsdk-next');
  Settings.initializeSDK();
  const result = await LoginManager.logInWithPermissions(['public_profile']);
  if (result.isCancelled) return null;
  const credential = await AccessToken.getCurrentAccessToken();
  if (!credential?.accessToken) throw new Error('Facebook no entregó la verificación. Vuelve a intentar.');
  return { provider, token: credential.accessToken };
}
