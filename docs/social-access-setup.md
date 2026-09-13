# Configurar el acceso social de ViajaYa

Estado del 2026-09-13: Google está configurado y certificado en Desarrollo (cliente web + cliente Android con el SHA-1 del keystore de debug; recorrido completo en emulador y teléfono). Facebook queda aplazado: Meta exige verificación de negocio para operar fuera del modo desarrollo, y la app mantiene su botón deshabilitado mientras `FACEBOOK_APP_ID` esté vacío. Pruebas todavía no tiene cliente Android propio (requiere el SHA-1 del keystore administrado por EAS). No se ha contratado un proveedor SMS: Desarrollo y Pruebas siguen usando OTP simulado; Producción continúa bloqueando el OTP hasta conectar el adaptador real.

## Credenciales por entorno

| Variante | Identificador Android | Prefijo de variables móviles |
|---|---|---|
| Desarrollo | `com.viajaya.app.dev` | Sin prefijo |
| Pruebas | `com.viajaya.app.testing` | `TESTING_` |
| Producción | `com.viajaya.app` | `PRODUCTION_` |

Google necesita un cliente OAuth Android asociado al identificador y a la huella SHA-1 del certificado que firma ese APK (Desarrollo: keystore de debug `mobile/android/app/debug.keystore`; Pruebas/Producción: `eas credentials -p android` muestra la huella del keystore administrado). Ese cliente solo se registra en Google; el SDK Android usa únicamente el ID del cliente web. También necesita un cliente OAuth web: su ID se configura como `GOOGLE_OAUTH_CLIENT_ID_WEB` en mobile y `GOOGLE_CLIENT_ID` en la API del mismo entorno. El SDK nativo solicita el ID token para esa audiencia. El cliente Android se registra en Google; no se pasa al SDK como audiencia del backend. Para iOS se configura además `GOOGLE_OAUTH_CLIENT_ID_IOS` y su esquema inverso se deriva mediante el plugin.

Facebook necesita una aplicación con Login, usuarios de prueba y la plataforma Android registrada con identificador, actividad y hash de firma (base64 del SHA-1 del certificado). Mientras la app de Meta esté en modo desarrollo solo entran sus roles; publicarla exige verificación de negocio. Mobile recibe `FACEBOOK_APP_ID` y `FACEBOOK_CLIENT_TOKEN`, que es el token público de cliente utilizado por el SDK. El backend recibe `FACEBOOK_APP_ID` y `FACEBOOK_APP_SECRET`; el secreto de aplicación nunca entra en mobile. No se necesitan permisos de correo para vincular la identidad. Facebook Limited Login en iOS requiere un contrato adicional y permanece deshabilitado.

Las variantes alojadas solo leen sus variables con prefijo. Configura los valores en el entorno local/EAS correspondiente sin versionar archivos `.env`. El backend anuncia los proveedores configurados en `GET /api/v1/auth/phone/capabilities`; la app exige además configuración móvil y que el APK contenga el SDK nativo.

## Compilar y comprobar

Los APK de F02-B descargados durante la transferencia no incluyen los nuevos SDK. Metro puede entregar la corrección del OTP a Desarrollo, pero Google/Facebook requieren un nuevo dev build y un nuevo APK de Pruebas. No se publicó ninguna compilación nueva durante esta continuación.

Antes de compilar se pueden comprobar las configuraciones sin credenciales reales:

```bash
cd mobile
node scripts/verify-environments.mjs --native
node scripts/verify-environments.mjs --native --social
```

Ambos comandos generan copias aisladas en `local-files/phase01/`. El segundo usa valores sintéticos, comprueba los recursos Facebook y mantiene desactivados inicio automático, eventos y recopilación publicitaria.

La pantalla de consentimiento de Google en modo *Testing* solo admite los usuarios de prueba registrados; con los scopes básicos (`openid`, `email`, `profile`) basta publicarla para admitir cualquier cuenta, sin verificación de Google.

Recorrido en cada Android con credenciales reales (Google completado en Desarrollo el 2026-09-13; pendiente en Pruebas):

1. Continuar con Google/Facebook desde una cuenta sin vincular: debe pedir teléfono y OTP sin permitir viajes todavía.
2. Verificar el número y confirmar la vinculación. Una cuenta nueva pide nombre y condiciones; una antigua conserva UUID, rol y viajes.
3. Salir y volver a entrar con el mismo proveedor: debe reutilizar la cuenta y mostrar una sesión administrada.
4. Cancelar el selector del proveedor o volver antes de confirmar: no debe crear ni vincular cuentas.
5. Probar una identidad ya vinculada a otro número: debe rechazar el conflicto y conservar las cuentas.
6. Verificar cierre de sesión, revocación y la separación entre Desarrollo y Pruebas.

Referencias de configuración: [Expo 56](https://docs.expo.dev/versions/v56.0.0/), [Google nativo en Expo](https://docs.expo.dev/guides/google-authentication/), [plugin de Google](https://react-native-google-signin.github.io/docs/setting-up/expo), [Facebook en Expo](https://docs.expo.dev/guides/facebook-authentication/), [validación de ID tokens de Google](https://developers.google.com/identity/sign-in/android/backend-auth) y [versión de Graph API del SDK de Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py).
