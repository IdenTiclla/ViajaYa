# F02 — Identidad por teléfono y OTP

Fecha: 2026-09-10. Fase en curso. **F02-A/B están implementados y ambas API están activadas y verificadas localmente**. Desarrollo responde también por la LAN y Metro sirve la interfaz nueva. Pruebas necesita recuperar una dirección HTTPS funcional antes de compilar el APK autorizado: dos túneles de Cloudflare se registraron pero sus dominios devolvieron NXDOMAIN. Se conserva el trabajo de F01 en la rama `codex/phase-01-environments`, sin commits ni publicación nuevos.

## Alcance del bloque A

- [x] Identidades verificadas separadas, vinculadas al UUID de cuenta existente y únicas por proveedor/identificador.
- [x] Desafíos OTP aleatorios, caducidad, intentos, límites por teléfono/IP/dispositivo y reenvío.
- [x] Verificación de uso único y comprobante temporal independiente de una sesión operativa.
- [x] Contrato HTTP, tipos generados y repositorio móvil mediante el cliente compartido.
- [x] Controlador y formulario móvil reutilizable con autofill de prueba, confirmación explícita, reintentos y salida para cambiar el número.
- [x] F02-B (código): acceso unificado, alta/condiciones de pruebas, sesiones por dispositivo, rotación/revocación, cambio de número y recuperación.
- [x] F02-B (API): respaldos, migraciones y acceso OTP/sesiones verificados contra Desarrollo y Pruebas locales.
- [ ] F02-B (distribución): recuperar HTTPS público, generar APK de Pruebas y recorrer las pantallas en los teléfonos.
- [ ] F02-C: Google/Facebook con vinculación explícita, migración probada de cuentas existentes y adaptador OTP real.

Las rutas de login y registro ahora componen el mismo acceso por teléfono. El APK de Pruebas instalado anteriormente conserva la interfaz de F01 hasta generar e instalar su actualización.

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

Producción responde 503 al acceso por teléfono hasta conectar el adaptador real de F02-C. Nunca cae al simulador como respaldo. No se enviaron SMS ni se contrató un proveedor. Las sesiones emitidas en la certificación de F02-B usaron cuentas y bases de prueba aisladas. Google/Facebook, el adaptador real y la migración social siguen pendientes en F02-C; soporte y su panel se completan en F03.

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

Guía para teléfono y estado operativo: `local-files/phase02/como-probar-f02b.md`. Los logs de verificación quedan en `local-files/phase02/`.

## Evidencia anterior de F02-A

- Suite backend: **671 pruebas unitarias/e2e aprobadas**. Una primera ejecución tuvo 36 errores al crear temporales de Windows; esas 36 se repitieron en un directorio nuevo del proyecto y aprobaron. Las suites opt-in existentes se mantienen separadas de los datos de Desarrollo/Pruebas.
- Pruebas HTTP nuevas: **22 casos**, incluyendo entornos bajos sin transporte externo, caducidad, reuso, límites, vínculo a teléfono/dispositivo/finalidad, rollback del comprobante y contrato productivo sin códigos de prueba.
- PostgreSQL desechable: migración reversible conservando cuenta/rol, unicidad de identidad y carreras entre ocho solicitudes, ocho verificaciones y ocho consumos. Una espera por lock no extiende la vigencia del código.
- Mobile: **249 pruebas aprobadas**, con 14 casos nuevos de controlador y contrato HTTP; TypeScript y lint aprobados.
- Metro compiló el formulario real para Android. Esto comprueba resolución y compilación; su recorrido visual en teléfono se certificará al conectar la ruta en F02-B.
- Ruff aprobado. OpenAPI y tipos móviles actualizados juntos. Los scripts y artefactos operativos viven en `local-files/phase02/`.
