# Configuring ViajaYa social access

Status as of 2026-09-13: Google is configured and certified in Development (web client + Android client with the debug keystore SHA-1; full walkthrough on emulator and phone). Facebook is postponed: Meta requires business verification to operate outside development mode, and the app keeps its button disabled while `FACEBOOK_APP_ID` is empty. Testing does not have its own Android client yet (it requires the SHA-1 of the EAS-managed keystore). No SMS provider has been hired: Development and Testing still use simulated OTP; Production keeps blocking OTP until the real adapter is connected.

## Credentials per environment

| Variant | Android identifier | Mobile variable prefix |
|---|---|---|
| Development | `com.viajaya.app.dev` | No prefix |
| Testing | `com.viajaya.app.testing` | `TESTING_` |
| Production | `com.viajaya.app` | `PRODUCTION_` |

Google needs an Android OAuth client associated with the identifier and with the SHA-1 fingerprint of the certificate that signs that APK (Development: debug keystore `mobile/android/app/debug.keystore`; Testing/Production: `eas credentials -p android` shows the fingerprint of the managed keystore). That client is only registered in Google; the Android SDK only uses the web client ID. It also needs a web OAuth client: its ID is configured as `GOOGLE_OAUTH_CLIENT_ID_WEB` in mobile and `GOOGLE_CLIENT_ID` in the API of the same environment. The native SDK requests the ID token for that audience. The Android client is registered in Google; it is not passed to the SDK as the backend audience. For iOS, `GOOGLE_OAUTH_CLIENT_ID_IOS` is also configured and its reversed scheme is derived through the plugin.

Facebook needs an app with Login, test users and the Android platform registered with identifier, activity and signature hash (base64 of the certificate SHA-1). While the Meta app is in development mode only its roles can sign in; publishing it requires business verification. Mobile receives `FACEBOOK_APP_ID` and `FACEBOOK_CLIENT_TOKEN`, which is the public client token used by the SDK. The backend receives `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`; the app secret never goes into mobile. No email permissions are needed to link the identity. Facebook Limited Login on iOS requires an additional contract and stays disabled.

Hosted variants only read their prefixed variables. Configure the values in the corresponding local/EAS environment without versioning `.env` files. The backend announces the configured providers in `GET /api/v1/auth/phone/capabilities`; the app also requires mobile configuration and an APK that contains the native SDK.

## Build and check

The F02-B APKs downloaded during the handover do not include the new SDKs. Metro can deliver the OTP fix to Development, but Google/Facebook require a new dev build and a new Testing APK. No new build was published during this continuation.

Before building, the configurations can be checked without real credentials:

```bash
cd mobile
node scripts/verify-environments.mjs --native
node scripts/verify-environments.mjs --native --social
```

Both commands generate isolated copies in `local-files/phase01/`. The second one uses synthetic values, checks the Facebook resources and keeps auto-init, events and advertising collection disabled.

The Google consent screen in *Testing* mode only admits the registered test users; with the basic scopes (`openid`, `email`, `profile`) publishing it is enough to admit any account, without Google verification.

Walkthrough on each Android with real credentials (Google completed in Development on 2026-09-13; pending in Testing):

1. Continue with Google/Facebook from an unlinked account: it must ask for phone and OTP without allowing rides yet.
2. Verify the number and confirm the linking. A new account asks for name and terms; an old one keeps its UUID, role and rides.
3. Sign out and sign in again with the same provider: it must reuse the account and show a managed session.
4. Cancel the provider picker or go back before confirming: it must not create or link accounts.
5. Try an identity already linked to another number: it must reject the conflict and keep the accounts.
6. Verify sign-out, revocation and the separation between Development and Testing.

Configuration references: [Expo 56](https://docs.expo.dev/versions/v56.0.0/), [native Google in Expo](https://docs.expo.dev/guides/google-authentication/), [Google plugin](https://react-native-google-signin.github.io/docs/setting-up/expo), [Facebook in Expo](https://docs.expo.dev/guides/facebook-authentication/), [Google ID token validation](https://developers.google.com/identity/sign-in/android/backend-auth) and [Meta SDK Graph API version](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py).
