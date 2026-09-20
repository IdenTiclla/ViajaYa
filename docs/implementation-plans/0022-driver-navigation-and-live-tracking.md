# Navegación del conductor y ubicación visible para el pasajero

19/09/2026 · Implementación local verificada; certificación en teléfono pendiente · Base: `e10e6ae`.

El commit anterior reúne los flujos y correcciones hasta revisión 21: 731 pruebas
backend, 396 móviles, Ruff/TypeScript/lint aprobados. No se hizo push.

## Entrega

- Seguimiento autorizado desde asignación hasta cierre, con posición, precisión,
  hora de captura, aviso de señal antigua y recuperación por snapshot.
- Publicación GPS con permisos del conductor; continuidad Android al abrir Waze.
  Ubicación reciente únicamente, sin guardar un historial de coordenadas en outbox.
- Canal WebSocket de ubicación privado por viaje, independiente de los streams
  durables de negociación. HTTP compartido para subir muestras y recuperar la
  última posición; Redis en modo distribuido, memoria en desarrollo local.
- Navegación nativa Google hacia recogida y después destino. Inicio/llegada/cierre
  siguen dependiendo del estado confirmado del viaje; el SDK no avanza el servicio.
- Waze opcional con destino de la etapa actual, pausa de voz de Google, regreso
  y manejo de app no instalada. No se obtiene GPS ni ETA de Waze.
- Vistas cenitales y sin edificios/interiores; conservar el tema claro solicitado.

## Compatibilidad

Expo 56 / React Native 0.85.3. Se fija el wrapper oficial Google Navigation en
0.16.3: la versión actual requiere RN 0.87+. La compatibilidad efectiva con 0.85.3
se verificó compilando Android para las cuatro arquitecturas. El plugin sustituye
la dependencia Maps por Navigation 7.6.1 tanto al compilar react-native-maps como
al empaquetar la app; no duplica clases. iOS mantiene sus mapas existentes y queda
fuera de esta integración nativa hasta certificar sus dependencias.
TaskManager usa la versión compatible resuelta por Expo 56. La integración
nativa requiere instalar un nuevo APK; recargar Metro no incorpora módulos nativos.

## Cierre y evidencia

- Backend: **746 aprobadas, 91 omitidas**, cinco advertencias existentes. Incluye
  permisos por participante, muestras antiguas, corte al cierre y sesión revocada.
- Redis real: **1 prueba aprobada** entre dos instancias, con snapshot, orden y TTL;
  utiliza claves exclusivas y no reinicia ni vacía Redis.
- Mobile: **429 aprobadas**; contratos GPS, caché HTTP/WS, permisos tardíos,
  continuidad del servicio, etapas y cancelación de la guía. TypeScript/lint/Ruff
  y contratos OpenAPI/GPS aprobados.
- UI: **12 escenarios aprobados**, taxi/moto, pasajero/conductor y tres etapas.
  Pantallas reales con dobles de GPS/mapa; no es validación de cartografía nativa.
- Android: `assembleDebug` aprobado; regeneración y segundo build aprobados (40 s).
  Firma verificada. APK sin `ACCESS_BACKGROUND_LOCATION`, con servicio visible
  `FOREGROUND_SERVICE_LOCATION` durante el viaje; se detiene al cierre.
- Metro: paquete Android completo de 12.091.433 bytes, con `transform.routerRoot=src/app`
  y `lazy=false`, comprobado incluyendo Navigation, GPS y recuperación de señal.
  El bundle genérico sin `routerRoot` solo verifica el runtime de Expo.
- Artefactos locales: `local-files/driver-navigation-2026-09-19/`: APK, SHA-256 y UI.
  [APK debug](../../local-files/driver-navigation-2026-09-19/viajaya-navigation-debug.apk).

**Política actual:** solo Desarrollo. Pruebas queda temporalmente deprecado por
instrucción del usuario; no se generan ni despliegan entregas allí. El plan y la
presentación pasan a revisión 23. Los tests automatizados continúan.

**Instalación en teléfonos:** APK de Desarrollo instalado y pantalla principal
verificada en Xiaomi 14T Pro (pasajero) y POCO F2 Pro (conductor).

**Pendiente en teléfonos:** confirmar que Navigation SDK
está habilitado para la clave/firma de Desarrollo, probar voz/Bluetooth, desvíos,
cobertura real de moto, permisos, bloqueo y retorno desde Waze con el pasajero en
otro teléfono. No se inició un emulador.
F05/F06 conservan su cierre productivo pendiente; push y traslado de consultas
propias de mapas al backend tampoco se cierran con esta entrega.

El commit `e10e6ae` guarda el trabajo anterior. La navegación, seguimiento y
actualización del plan se registran en un commit independiente en la misma rama;
no se hizo push.

## Corrección tras las pruebas en Android

El usuario reportó Waze funcionando, navegación Google sin buena adquisición
de GPS y ausencia del vehículo en el mapa del pasajero. Se corrigieron:

- La navegación registraba el callback, pero no activaba `startUpdatingLocation`
  después de inicializar el SDK. Ahora inicia esa suscripción antes de esperar
  GPS, muestra la ubicación con permiso y la detiene al salir. Un fallo previo
  a inicializar no intenta detener un navegador inexistente.
- El arranque del seguimiento solo protegía una sesión que ya estuviera
  enviando. Un evento de regreso del diálogo de permisos podía sustituir el
  arranque pendiente. Ahora conserva ese arranque y consulta permisos ya
  concedidos antes de abrir un diálogo. Una posición reciente disponible se
  publica sin esperar el primer evento del servicio continuo.
- Fast Refresh reemplaza también el callback de TaskManager, evitando que
  conserve el contexto anterior. Se mantienen cancelación, validación de
  precisión, antigüedad y detención al cerrar el viaje.
- El marcador confundía rumbo desconocido con vehículo desconocido: ocultaba
  el auto/moto y dejaba un punto. El vehículo conserva su dibujo sin orientación;
  la flecha solo aparece con rumbo válido. Taxi/moto recuperan el tipo desde el
  servicio cuando falta ese dato en el perfil.

Evidencia: **442 pruebas móviles aprobadas**, incluidas 13 nuevas regresiones;
**15 pruebas backend de ubicación aprobadas**, TypeScript y lint oficial de
Expo aprobados. Paquete Android completo generado por Metro con estas
correcciones. No hay cambios nativos ni necesidad de otro APK.

**Verificación física de esta corrección pendiente:** el POCO quedó suspendido
con un diálogo de permisos y después perdió su conexión al depurador de Metro;
se solicitó mantener ambos teléfonos abiertos en el viaje. No se certifica aún
la adquisición de GPS de Google ni el movimiento del marcador entre teléfonos.

Referencias: [Expo Location 56](https://docs.expo.dev/versions/v56.0.0/sdk/location/),
[wrapper 0.16.3](https://github.com/googlemaps/react-native-navigation-sdk/tree/v0.16.3),
[Waze](https://developers.google.com/waze/deeplinks).
