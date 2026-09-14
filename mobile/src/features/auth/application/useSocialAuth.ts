/** Obtain a provider proof; account creation and linking remain in the phone flow. */
import { exchangeCodeAsync, makeRedirectUri, ResponseType, useAuthRequest } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { env } from '@/core/config/env';
import { nativeSocialAvailable, requestNativeSocialCredential } from '../data/nativeSocialAuth';
import type { SocialCredential, SocialProvider } from '../domain/phoneAccess';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_PLACEHOLDER = '000000000000-placeholder.apps.googleusercontent.com';
const FACEBOOK_PLACEHOLDER = '000000000000000';
const facebookDiscovery = {
  authorizationEndpoint: 'https://www.facebook.com/v26.0/dialog/oauth',
  tokenEndpoint: 'https://graph.facebook.com/v26.0/oauth/access_token',
};

type Options = {
  onCredential?: (credential: SocialCredential) => Promise<void>;
  onError?: (message: string) => void;
};

export function useSocialAuth({ onCredential, onError }: Options = {}) {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; locked.current = false; }, []);

  const googleClientId = Platform.OS === 'android' ? env.googleClientIds.android
    : Platform.OS === 'ios' ? env.googleClientIds.ios : env.googleClientIds.web;
  const [googleRequest, , promptGoogle] = Google.useAuthRequest({
    iosClientId: env.googleClientIds.ios || GOOGLE_PLACEHOLDER,
    androidClientId: env.googleClientIds.android || GOOGLE_PLACEHOLDER,
    webClientId: env.googleClientIds.web || GOOGLE_PLACEHOLDER,
    shouldAutoExchangeCode: false,
    ...(Platform.OS === 'web' ? { responseType: ResponseType.IdToken } : {}),
  });
  const [facebookRequest, , promptFacebook] = useAuthRequest({
    clientId: env.facebookAppId || FACEBOOK_PLACEHOLDER,
    redirectUri: makeRedirectUri({ native: `fb${env.facebookAppId || FACEBOOK_PLACEHOLDER}://authorize` }),
    responseType: ResponseType.Token, usePKCE: false, scopes: ['public_profile'],
  }, facebookDiscovery);

  async function open(provider: SocialProvider) {
    const request = provider === 'google' ? googleRequest : facebookRequest;
    const configured = Platform.OS === 'web'
      ? provider === 'google' ? googleClientId : env.facebookAppId
      : nativeSocialAvailable(provider);
    if (locked.current || !configured || (Platform.OS === 'web' && !request)) return;
    locked.current = true;
    const current = ++generation.current;
    setPending(provider);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (Platform.OS !== 'web') {
        const credential = await requestNativeSocialCredential(provider);
        if (current === generation.current && credential && onCredential) await onCredential(credential);
        return;
      }
      const result = await (provider === 'google' ? promptGoogle() : promptFacebook());
      if (current !== generation.current || result.type === 'cancel' || result.type === 'dismiss') return;
      if (result.type !== 'success') throw new Error('No pudimos validar la cuenta. Vuelve a intentar.');
      let token: string | undefined = provider === 'google' ? result.authentication?.idToken || result.params.id_token
        : result.authentication?.accessToken || result.params.access_token;
      if (provider === 'google' && result.params.code && !token) {
        const authentication = await Promise.race([
          exchangeCodeAsync({
            clientId: googleClientId, code: result.params.code, redirectUri: request!.redirectUri,
            extraParams: { code_verifier: request!.codeVerifier ?? '' },
          }, Google.discovery),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Google tardó en responder. Vuelve a intentar.')), 15_000);
          }),
        ]);
        token = authentication.idToken;
      }
      if (current !== generation.current) return;
      if (!token) throw new Error('No recibimos la verificación del proveedor. Vuelve a intentar.');
      if (!onCredential) throw new Error('Entra por teléfono para vincular tu cuenta social.');
      await onCredential({ provider, token });
    } catch (error) {
      if (current === generation.current) onError?.(
        error instanceof Error ? error.message : 'No pudimos abrir el acceso. Vuelve a intentar.',
      );
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) { locked.current = false; setPending(null); }
    }
  }

  return {
    signInWithGoogle: () => { void open('google'); },
    signInWithFacebook: () => { void open('facebook'); },
    googleLoading: pending === 'google', facebookLoading: pending === 'facebook',
    googleDisabled: pending !== null || (Platform.OS === 'web'
      ? !googleClientId || !googleRequest : !nativeSocialAvailable('google')),
    facebookDisabled: pending !== null || (Platform.OS === 'web'
      ? !env.facebookAppId || !facebookRequest : !nativeSocialAvailable('facebook')),
  };
}
