# F02 — Identidad por teléfono y OTP

Fecha inicial: 2026-09-10. Actualización: 2026-09-13. Fase en curso. **Google certificado en Desarrollo** (emulador y teléfono físico) el 2026-09-13; Facebook aplazado por la verificación de negocio de Meta. **F02-A/B están implementados y ambas API están activadas y verificadas localmente**. Desarrollo responde por la LAN; Pruebas tiene HTTPS mediante ngrok y un APK de F02-B descargado y verificado. Esta continuación corrige el OTP y añade el acceso/vinculación social de F02-C. Las credenciales sociales, el nuevo APK con adaptadores nativos y el recorrido manual siguen pendientes. Se conserva la rama `codex/phase-01-environments`, sin commits ni publicación nuevos.

## Alcance del bloque A

- [x] Identidades verificadas separadas, vinculadas al UUID de cuenta existente y únicas por proveedor/identificador.
- [x] Desafíos OTP aleatorios, caducidad, intentos, límites por teléfono/IP/dispositivo y reenvío.
- [x] Verificación de uso único y comprobante temporal independiente de una sesión operativa.
- [x] Contrato HTTP, tipos generados y repositorio móvil mediante el cliente compartido.
- [x] Controlador y formulario móvil reutilizable con autofill de prueba, confirmación explícita, reintentos y salida para cambiar el número.
- [x] F02-B (código): acceso unificado, alta/condiciones de pruebas, sesiones por dispositivo, rotación/revocación, cambio de número y recuperación.
- [x] F02-B (API): respaldos, migraciones y acceso OTP/sesiones verificados contra Desarrollo y Pruebas locales.
- [x] F02-B (distribución inicial): HTTPS público recuperado con ngrok y APK de Pruebas de F02-B verificado.
- [ ] F02-B (certificación): actualizar Pruebas con las correcciones de entrada/OTP y completar el recorrido manual en ambas variantes.
- [x] F02-C (código): acceso social, vinculación explícita y migración de cuentas Google/Facebook con pruebas HTTP y PostgreSQL.
- [x] F02-C (certificación Google, Desarrollo): cliente web + cliente Android en Google Cloud, dev build con SDK nativo y recorrido Google → teléfono → OTP → vinculación en emulador y en un Xiaomi físico (2026-09-13).
- [ ] F02-C (certificación Google, Pruebas): SHA-1 del keystore de EAS registrado, `TESTING_GOOGLE_OAUTH_CLIENT_ID_WEB` en EAS, `GOOGLE_CLIENT_ID` en la API de Pruebas y APK `preview` recorrido en teléfono.
- [ ] F02-C (Facebook): aplazado el 2026-09-13; Meta exige verificación de negocio para salir del modo desarrollo. El código queda listo y los botones permanecen deshabilitados mientras `FACEBOOK_APP_ID` esté vacío. Limited Login en iOS sigue pendiente.
- [ ] F02-C (SMS): elegir proveedor e implementar el adaptador real. El usuario confirmó el 2026-09-11 que aún no eligió uno.

Las rutas de login y registro componen el mismo acceso por teléfono. El APK de Pruebas descargado durante la transferencia ya incluye F02-B; conserva la versión anterior a las correcciones y al acceso social de esta continuación.

## Contrato y decisiones

`POST /api/v1/auth/phone/challenges` recibe `phone`, `device_id` (UUID de instalación) y `purpose=sign_in`. Devuelve el teléfono normalizado a E.164, `challenge_id`, `expires_at` y `resend_after_seconds`. Bolivia (`BO`) es el país inicial permitido; los metadatos de `phonenumbers` validan números y `PHONE_OTP_ALLOWED_REGIONS` permite ampliar la lista sin fijar +591 en el servidor.

Solo el esquema de Desarrollo/Pruebas admite `test_code`, y el backend lo omite si `OTP_TEST_AUTOFILL=false`. La ayuda móvil también puede desactivarse con su configuración de entorno. El esquema OpenAPI de Producción no contiene `test_code`; el cliente productivo descarta ese campo incluso si una respuesta incorrecta lo incluye.

`POST /api/v1/auth/phone/verify` añade `challenge_id` y `code`. El resultado es `verification_token` con cinco minutos de validez, ligado al teléfono, dispositivo, finalidad y entorno. No sirve como JWT de acceso ni revela si existe una cuenta. Su consumo queda dentro de la transacción de la futura operación de cuenta; un rollback devuelve la posibilidad de intentarlo y un commit impide reutilizarlo.

Los códigos tienen seis dígitos aleatorios por desafío, cinco minutos de validez por defecto y cinco intentos. Se guardan mediante HMAC con separación por entorno y desafío; tampoco se guarda el comprobante en texto plano. No se usa un código universal ni se consulta un proveedor externo en entornos bajos. Reenviar invalida el código y comprobante anteriores para el mismo teléfono/dispositivo/finalidad.

| Operación | Límite inicial |
|---|---|
| Reenvío por teléfono | Uno cada 60 segundos |
| Solicitud por teléfono | Cinco por 15 minutos |
| Solicitud por dispositivo | Diez por 15 minutos |
| Solicitud por IP | Treinta por 15 minutos |
| Verificación por dispositivo | Treinta por cinco minutos |
| Verificación por IP | Cien por cinco minutos |

Las ventanas son compartidas en PostgreSQL; no dependen de memoria de un worker. Los rechazos devuelven 429 y `Retry-After`. La IP procede del cliente ASGI; el despliegue debe configurar sus proxies de confianza, sin aceptar cabeceras arbitrarias del cliente como identidad.

La migración `0024_phone_verification` añade `user_identities`, `phone_challenges` y `phone_rate_budgets`. No cambia IDs, roles ni teléfonos históricos, y no marca identidades antiguas como verificadas. La limpieza oportunista retira en lotes acotados desafíos y contadores vencidos hace más de un día; no garantiza borrado puntual si el servicio queda sin solicitudes. La política general de conservación se cierra en F09.

## Activación y límites

`PHONE_OTP_ENABLED=false` por defecto permite preparar el código sin habilitar el acceso. F02-B necesita `0025_managed_accounts`. Desarrollo y Pruebas ya tienen ambas migraciones y el acceso habilitado, con respaldos previos. Activación, respaldos e informe de pruebas reales: `local-files/phase02/`.

Producción responde 503 al acceso por teléfono hasta conectar el adaptador real de F02-C. Nunca cae al simulador como respaldo. No se enviaron SMS ni se contrató un proveedor. Las sesiones emitidas en la certificación de F02-B usaron cuentas y bases de prueba aisladas. La certificación de Google/Facebook y el adaptador SMS real siguen pendientes; soporte y su panel se completan en F03.

## F02-B: cuentas y sesiones

- `GET /auth/phone/capabilities` declara países y prefijos permitidos, disponibilidad y versión/texto de las condiciones. Las condiciones actuales son exclusivamente de pruebas; no sustituyen los términos legales de producción.
- `POST /auth/phone/complete` recibe número, comprobante, UUID de instalación, nombre del dispositivo y `request_id`. Devuelve `profile_required` o `authenticated` con usuario y tokens. Un usuario nuevo completa nombre y condiciones; no necesita correo y nace como pasajero. Repetir la misma operación recupera la misma sesión mientras el comprobante sigue vigente y su refresh no se utilizó.
- `POST /auth/phone/link-legacy` añade correo/contraseña anteriores y conserva UUID, rol e historial. Nunca fusiona por teléfono histórico ni correo coincidente. Un intento de contraseña fallido consume ese comprobante; contraseñas de 72 o más bytes UTF-8 requieren recuperación asistida para evitar ambigüedad histórica por truncamiento. Vincular deshabilita las credenciales antiguas de esa cuenta.
- `POST /auth/refresh` admite `request_id`, rota el refresh y registra su consumo. Un reintento con el mismo ID durante 30 segundos recupera el sucesor sin rotar otra vez. Reutilización con otro ID o fuera de esa ventana revoca la sesión y deja auditoría. El vencimiento absoluto de la sesión no se prolonga indefinidamente.
- `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `DELETE /auth/sessions/others` y `POST /auth/logout` gestionan sesiones propias. Los JWT llevan `sid` y `jti`; HTTP comprueba sesión/cuenta en la base. El WebSocket valida al conectar y cada cinco segundos con una transacción nueva: revocación/caducidad cierra con 1008 y un fallo de validación con 1012. El monitor deja terminar la limpieza de conexiones al desconectar.
- `POST /auth/phone/change/challenges`, `/change/verify` y `/change` exigen una sesión iniciada en los últimos cinco minutos y un comprobante del número nuevo ligado al usuario. Cambiarlo conserva la cuenta, revoca sesiones anteriores y emite una nueva para el teléfono actual. Una carrera con el login del número anterior no permite recuperar a su propietario previo.
- `POST /auth/recovery` registra un caso después de verificar un número de contacto con finalidad `recovery`. No asigna una cuenta ni emite tokens. `ReviewAccountRecovery` exige un puerto de autorización de operador, evidencia, decisión y auditoría; deliberadamente no tiene una ruta pública ni concede privilegios a pasajeros/conductores. El adaptador de permisos y el panel corresponden a F03. `/auth/recovery/complete` exige aprobación vigente (24 h) y una verificación nueva; conserva UUID/rol y revoca accesos anteriores. El código de caso se puede copiar desde la app.

El almacenamiento móvil guarda el par de tokens y el ID del próximo refresh en un único valor cifrado. Migra las claves antiguas al renovar, serializa las escrituras, acota cada espera nativa a cinco segundos y usa una marca de cierre para no restaurar credenciales viejas. Errores de red conservan los tokens; 401 confirmado lleva al acceso. Volver, cambiar número y reintentar descartan las respuestas de intentos abandonados.

Los JWT antiguos sin sesión administrada se aceptan transitoriamente para cuentas aún no migradas. Ese acceso no aparece como sesión revocable por dispositivo; deja de servir al vincular/cambiar/recuperar el teléfono. El retiro definitivo de endpoints y enlaces OAuth antiguos pertenece a F02-C.

## Evidencia de F02-B

- OTP en Desarrollo (2026-09-11): los registros mostraban respuestas 429 al repetir solicitudes; no se observaron errores 500 de generación. La app descartaba el desafío al fallar un reenvío. Ahora conserva el código no vencido, permite verificarlo aunque el reenvío tenga espera y distingue ese límite del límite de verificación. Sin desafío disponible, muestra la espera y reintenta al vencer `Retry-After` mientras la pantalla permanece activa. Cambiar de número o salir cancela el intento. También interpreta `retry_after_seconds` cuando no está la cabecera. Pruebas de regresión: límite inicial, reenvío fallido, verificación durante la espera y cancelación de respuestas tardías.
- Recorrido en Desarrollo (2026-09-11): se reportó «La solicitud no es válida» después
  del login. El stack del pasajero abría `booking/offers` sin `rideId` porque era su
  primera pantalla declarada. Se establece `(tabs)` como entrada explícita; Home
  conserva la recuperación del viaje activo. Dos pruebas de regresión reprodujeron
  el fallo antes del cambio y aprobaron después. Suite móvil: **260 aprobadas**,
  TypeScript y lint aprobados. La confirmación manual del usuario sigue pendiente;
  el APK de Pruebas descargado anteriormente requiere una nueva compilación para
  incorporar esta corrección.
- Suite completa del backend: **685 pruebas unitarias/e2e aprobadas**; dos advertencias de deprecación existentes de Starlette. Ruff, OpenAPI y contrato de tiempo real aprobados.
- Pruebas HTTP: alta sin correo, términos vigentes, rol fijo, comprobantes ligados a número/dispositivo, reintentos idempotentes, migración de conductor conservando UUID/rol, contraseñas ambiguas, refresh repetido, separación de dispositivos, revocación propia, cambio de número y recuperación con autorización.
- PostgreSQL: ocho altas simultáneas crean una cuenta/sesión; distintos IDs no reutilizan un comprobante; ocho refresh simultáneos rotan una vez; cambiar el número mientras otro login espera no entrega la cuenta anterior. La migración rechaza un downgrade que perdería cuentas sin correo.
- Suite PostgreSQL completa en una base desechable: **67 aprobadas y 11 omitidas**. Ocho requieren POSIX (señales/sockets heredados); tres requieren una URL de Redis de pruebas. Se corrigió el sembrado de la prueba histórica de la migración 0022 para usar únicamente las columnas disponibles en esa revisión.
- WebSocket: las 34 pruebas existentes volvieron a pasar después de corregir la limpieza del monitor. Una prueba adicional comprueba el cierre de una conexión viva tras logout y el rechazo al reconectar.
- Mobile: 258 pruebas aprobadas, TypeScript y lint aprobados. Metro compiló la entrada Android completa. La vista de 320 px y texto al 200 % está preparada en `local-files/phase02/phone-entry-preview.html`; el navegador bloqueó su apertura, por lo que no se declara una revisión visual ni de TalkBack completada.
- Imagen Docker activada en Pruebas y archivo EAS de 235 archivos móviles revisado, con exclusión de backend, `.env` y firma. El usuario autorizó explícitamente el envío del código móvil, la clave Android de Maps y la URL pública a EAS. No se generó un APK de F02-B: queda pendiente una dirección HTTPS funcional.
- Prueba real en ambas API locales: OTP simulado, perfil pendiente sin tokens, alta sin correo como pasajero, reintento idempotente, sesión administrada, rotación/reintento de refresh, revocación de access/refresh al salir y rechazo de tokens cruzados. Informe: `local-files/phase02/live-phone-verification-local.json`.
- Compatibilidad en vivo: login del conductor existente y recepción del snapshot por WebSocket aprobados en ambos servicios locales; las API permanecieron listas después de desconectar. Informe: `local-files/phase02/local-websocket-verification.json`.
- Se recuperó Docker conservando con otro nombre dos directorios que solo contenían sockets temporales vacíos e inaccesibles. Los volúmenes y las imágenes permanecieron intactos. Los dos dominios temporales de Cloudflare probados devolvieron NXDOMAIN, incluso al consultar DNS público/autoritativo; no se declara la certificación HTTPS/WS pública completada. Se propuso ngrok gratuito con dominio asignado estable, sujeto a la cuenta del usuario.

Guía actual para teléfono y estado operativo: `local-files/phase02/f02b-phone-checklist.md`. Los logs de verificación quedan en `local-files/phase02/`; los párrafos anteriores sobre Cloudflare documentan la situación previa a recuperar ngrok.

## F02-C: acceso social y vinculación

- `GET /auth/phone/capabilities` añade `social_providers`. Solo anuncia proveedores con configuración de servidor; clientes anteriores ignoran el campo y los nuevos toleran servidores sin él.
- `POST /auth/social/{provider}/sign-in` verifica el token del proveedor y recibe instalación/nombre de dispositivo. Devuelve `phone_required` sin crear cuenta ni sesión si todavía falta la vinculación con un teléfono verificado. Una identidad ya vinculada recibe una sesión administrada y revocable.
- La app solicita número y OTP, muestra una confirmación explícita y llama a `POST /auth/phone/link-social`. Ambos comprobantes se verifican antes de vincular. Los usuarios nuevos completan nombre y condiciones; las cuentas anteriores se buscan exclusivamente por proveedor/identificador, conservando UUID, datos y rol. El correo del proveedor no fusiona cuentas.
- La vinculación, el consumo del OTP y la emisión de sesión comparten transacción. El bloqueo PostgreSQL sigue el orden identidad social → teléfono → cuenta; la unicidad existente impide mover una identidad o reemplazar silenciosamente otra del mismo proveedor. Repetir el comprobante y `request_id` recupera el resultado. Una identidad social no cambia un teléfono ya verificado por otro número.
- `/auth/oauth/{provider}` queda como puente para cuentas sociales históricas aún no migradas. Ya no crea cuentas ni fusiona por correo; deja de autenticar al completar la migración. Su eliminación definitiva exige certificar la transición de los clientes existentes.
- Google usa el SDK nativo y un ID token cuya audiencia corresponde al cliente web del servidor. La verificación de certificados se ejecuta fuera del event loop y con espera acotada. Facebook Android usa el SDK nativo; el backend valida aplicación, tipo USER, vigencia e igualdad del sujeto entre `debug_token` y `me`, sin exigir correo. Graph API v26.0; los tokens no se registran mediante el log de URLs de HTTPX.
- Los SDK nativos se cargan al usarlos; un APK anterior mantiene el acceso por teléfono y deja los botones sociales deshabilitados. Facebook no se inicializa al abrir la app ni registra eventos/publicidad automáticamente. Facebook en iOS queda deshabilitado hasta implementar y verificar Limited Login con nonce. La web conserva AuthSession; no se certificó su recorrido con proveedores reales.

Evidencia manual del 2026-09-13 (Desarrollo): `GET /auth/phone/capabilities` anuncia `social_providers: ["google"]`; el recorrido completo registró `POST /auth/social/google/sign-in` 200 → `POST /auth/phone/challenges` 201 → `POST /auth/phone/verify` 200 → `POST /auth/phone/link-social` 200, primero en el emulador `viajaya_pasajero` y después en un teléfono Xiaomi con el mismo dev build (`com.viajaya.app.dev`, keystore de debug), donde la identidad ya vinculada reutilizó la cuenta. La pantalla de consentimiento sigue en modo *Testing*: solo entran los usuarios de prueba registrados; publicarla (scopes básicos, sin verificación de Google) abre el acceso a cualquier cuenta. La IP LAN de Desarrollo cambió a `192.168.1.57`. Sin cambios de código en esta certificación.

Evidencia automatizada de la continuación anterior: **701 pruebas backend y 275 móviles aprobadas**, Ruff, TypeScript, lint, OpenAPI y tipos generados aprobados. **7 pruebas PostgreSQL aprobadas** en una base recién creada y eliminada al finalizar, incluidas ocho vinculaciones simultáneas idempotentes y dos teléfonos compitiendo por una identidad. Generación Android verificada en copias aisladas para Desarrollo, Pruebas y Producción, con proveedores ausentes y con configuración sintética. El bundle completo servido por Metro incluye la espera/reintento del OTP, la confirmación social y la detección de SDK nativo; ambas API y HTTPS de Pruebas devolvieron 200 al finalizar. Estas comprobaciones no certifican un APK firmado ni un login real en Google/Facebook. Pruebas conserva su imagen/API de F02-B hasta desplegar el nuevo código. Guía de configuración y límites: [acceso social](../social-access-setup.md).

## Evidencia anterior de F02-A

- Suite backend: **671 pruebas unitarias/e2e aprobadas**. Una primera ejecución tuvo 36 errores al crear temporales de Windows; esas 36 se repitieron en un directorio nuevo del proyecto y aprobaron. Las suites opt-in existentes se mantienen separadas de los datos de Desarrollo/Pruebas.
- Pruebas HTTP nuevas: **22 casos**, incluyendo entornos bajos sin transporte externo, caducidad, reuso, límites, vínculo a teléfono/dispositivo/finalidad, rollback del comprobante y contrato productivo sin códigos de prueba.
- PostgreSQL desechable: migración reversible conservando cuenta/rol, unicidad de identidad y carreras entre ocho solicitudes, ocho verificaciones y ocho consumos. Una espera por lock no extiende la vigencia del código.
- Mobile: **249 pruebas aprobadas**, con 14 casos nuevos de controlador y contrato HTTP; TypeScript y lint aprobados.
- Metro compiló el formulario real para Android. Esto comprueba resolución y compilación; su recorrido visual en teléfono se certificará al conectar la ruta en F02-B.
- Ruff aprobado. OpenAPI y tipos móviles actualizados juntos. Los scripts y artefactos operativos viven en `local-files/phase02/`.
