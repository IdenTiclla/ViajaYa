import type { ExpoConfig, ConfigContext } from 'expo/config';

import { resolveBuildEnvironment } from './src/core/config/environment';

/**
 * Build-time configuration. Only public mobile configuration belongs in extra.
 * Server secrets must never enter the bundle or the native application manifest.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = resolveBuildEnvironment(process.env);
  const socialPlugins: NonNullable<ExpoConfig['plugins']> = ['./plugins/withSocialSdkDefaults'];
  if (environment.googleClientIds.ios) {
    socialPlugins.push(['@react-native-google-signin/google-signin', {
      iosUrlScheme: environment.googleClientIds.ios.split('.').reverse().join('.'),
    }]);
  }
  if (environment.facebookAppId && environment.facebookClientToken) {
    socialPlugins.push(['react-native-fbsdk-next', {
      appID: environment.facebookAppId, clientToken: environment.facebookClientToken,
      displayName: environment.name, scheme: `fb${environment.facebookAppId}`,
      isAutoInitEnabled: false, autoLogAppEventsEnabled: false,
      advertiserIDCollectionEnabled: false, iosUserTrackingPermission: false,
    }]);
  }
  return {
    ...config,
    name: environment.name,
    slug: 'viajaya',
    owner: 'iden',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: environment.scheme,
    runtimeVersion: `1.0.0-${environment.appEnv}`,
    // OTA remains disabled until its delivery and rollback are certified in F09.
    updates: { enabled: false },
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: environment.appId,
      config: {
        googleMapsApiKey: environment.googleMapsApiKeyIos,
      },
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'ViajaYa usa tu ubicación para mostrar tu posición en el mapa y coordinar viajes y encomiendas.',
      },
    },
    android: {
      package: environment.appId,
      adaptiveIcon: {
        backgroundColor: '#16308C',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      config: {
        googleMaps: {
          apiKey: environment.googleMapsApiKeyAndroid,
        },
      },
      permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
      blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION'],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      ...socialPlugins,
      'expo-router',
      './plugins/withDriverNavigation',
      'expo-secure-store',
      ['expo-dev-client', { addGeneratedScheme: environment.appEnv === 'development' }],
      [
        'expo-splash-screen',
        {
          backgroundColor: '#16308C',
          android: {
            image: './assets/images/splash-icon.png',
            imageWidth: 76,
          },
        },
      ],
      [
        'expo-location',
        {
          isAndroidForegroundServiceEnabled: true,
          locationAlwaysAndWhenInUsePermission: 'Durante un viaje como conductor, ViajaYa comparte tu ubicación con tu pasajero aunque uses Waze o bloquees la pantalla.',
          locationWhenInUsePermission:
            'ViajaYa usa tu ubicación para mostrar tu posición en el mapa y coordinar viajes y encomiendas.',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: { projectId: 'c3d5798c-c17f-4257-b14e-e09f2d92272c' },
      appEnv: environment.appEnv,
      appId: environment.appId,
      scheme: environment.scheme,
      apiUrl: environment.apiUrl,
      otpMode: environment.otpMode,
      otpTestAutofill: environment.otpTestAutofill,
      // Existing HTTP map calls move behind the backend in F05.
      googleMapsApiKey: environment.googleMapsApiKey,
      googleClientIds: environment.googleClientIds,
      facebookAppId: environment.facebookAppId,
      facebookClientToken: environment.facebookClientToken,
    },
  };
};
