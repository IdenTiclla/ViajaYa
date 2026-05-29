import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Configuración dinámica de Expo para ViajaYa (TaxiGo).
 * Las claves y URLs sensibles se leen de variables de entorno y se exponen a la
 * app vía `extra` (accesible con expo-constants). Ver `.env.example`.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ViajaYa',
  slug: 'viajaya',
  owner: 'iden',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'viajaya',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.viajaya.app',
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY_IOS,
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'ViajaYa usa tu ubicación para mostrar tu posición en el mapa y coordinar viajes y encomiendas.',
    },
  },
  android: {
    package: 'com.viajaya.app',
    adaptiveIcon: {
      backgroundColor: '#16308C',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID,
      },
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
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
    apiUrl: process.env.API_URL ?? 'http://localhost:8000/api/v1',
    googleClientIds: {
      ios: process.env.GOOGLE_OAUTH_CLIENT_ID_IOS ?? '',
      android: process.env.GOOGLE_OAUTH_CLIENT_ID_ANDROID ?? '',
      web: process.env.GOOGLE_OAUTH_CLIENT_ID_WEB ?? '',
    },
    facebookAppId: process.env.FACEBOOK_APP_ID ?? '',
  },
});
