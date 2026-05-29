/**
 * SSO con Google y Facebook vía expo-auth-session.
 *
 * Flujo token-based: la app obtiene el token del proveedor (id_token de Google /
 * access_token de Facebook) y lo envía al backend (`authStore.signInWithOAuth`),
 * que lo verifica y emite los JWT propios. El gate de navegación redirige solo
 * al cambiar el estado de sesión.
 *
 * Los botones quedan deshabilitados mientras no se configuren los client IDs
 * (ver `.env.example`).
 */
import * as Facebook from 'expo-auth-session/providers/facebook';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';

import { env } from '@/core/config/env';
import { getApiErrorMessage } from '@/core/errors/apiError';
import { useAuthStore } from '@/store/authStore';

WebBrowser.maybeCompleteAuthSession();

// expo-auth-session valida en tiempo de render que exista el clientId de la
// plataforma actual y LANZA si falta (en Android, `androidClientId`). Como las
// reglas de hooks impiden llamar `useAuthRequest` de forma condicional, pasamos
// placeholders con formato válido cuando aún no hay client IDs configurados: el
// hook no revienta y el botón queda deshabilitado, así que nunca se usan.
const PLACEHOLDER_GOOGLE_CLIENT_ID = '000000000000-placeholder.apps.googleusercontent.com';
const PLACEHOLDER_FACEBOOK_APP_ID = '000000000000000';

type Provider = 'google' | 'facebook';
type Options = { onError?: (message: string) => void };

export function useSocialAuth({ onError }: Options = {}) {
  const signInWithOAuth = useAuthStore((s) => s.signInWithOAuth);
  const [pending, setPending] = useState<Provider | null>(null);

  const googleConfigured = Boolean(
    env.googleClientIds.ios || env.googleClientIds.android || env.googleClientIds.web,
  );
  const facebookConfigured = Boolean(env.facebookAppId);

  const [googleRequest, googleResponse, promptGoogle] = Google.useAuthRequest({
    iosClientId: env.googleClientIds.ios || PLACEHOLDER_GOOGLE_CLIENT_ID,
    androidClientId: env.googleClientIds.android || PLACEHOLDER_GOOGLE_CLIENT_ID,
    webClientId: env.googleClientIds.web || PLACEHOLDER_GOOGLE_CLIENT_ID,
  });
  const [facebookRequest, facebookResponse, promptFacebook] = Facebook.useAuthRequest({
    clientId: env.facebookAppId || PLACEHOLDER_FACEBOOK_APP_ID,
  });

  const exchange = useCallback(
    async (provider: Provider, token: string | undefined) => {
      if (!token) {
        setPending(null);
        onError?.(`No se recibió el token de ${provider}.`);
        return;
      }
      try {
        await signInWithOAuth(provider, token);
      } catch (error) {
        onError?.(getApiErrorMessage(error));
      } finally {
        setPending(null);
      }
    },
    [signInWithOAuth, onError],
  );

  /* Reaccionamos a la respuesta del flujo OAuth, que expo-auth-session entrega
     como estado (`response`). Sincronizar ese resultado de un sistema externo
     con nuestro estado mediante un effect es el patrón documentado; desactivamos
     la heurística set-state-in-effect para estos dos effects. */
  /* eslint-disable react-hooks/set-state-in-effect */
  // Reacciona a la respuesta del flujo de Google.
  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type === 'success') {
      void exchange('google', googleResponse.params?.id_token);
    } else if (googleResponse.type === 'error') {
      setPending(null);
      onError?.('No se pudo autenticar con Google.');
    } else {
      setPending(null); // cancel / dismiss
    }
    // exchange/onError son estables para esta respuesta concreta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  // Reacciona a la respuesta del flujo de Facebook.
  useEffect(() => {
    if (!facebookResponse) return;
    if (facebookResponse.type === 'success') {
      void exchange('facebook', facebookResponse.authentication?.accessToken);
    } else if (facebookResponse.type === 'error') {
      setPending(null);
      onError?.('No se pudo autenticar con Facebook.');
    } else {
      setPending(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facebookResponse]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const signInWithGoogle = useCallback(() => {
    setPending('google');
    void promptGoogle();
  }, [promptGoogle]);

  const signInWithFacebook = useCallback(() => {
    setPending('facebook');
    void promptFacebook();
  }, [promptFacebook]);

  return {
    signInWithGoogle,
    signInWithFacebook,
    googleLoading: pending === 'google',
    facebookLoading: pending === 'facebook',
    googleDisabled: !googleConfigured || !googleRequest || pending !== null,
    facebookDisabled: !facebookConfigured || !facebookRequest || pending !== null,
  };
}
