# Plan de salida a producción de ViajaYa

Fecha inicial: 9 de septiembre de 2026. Actualización: 10 de septiembre de 2026. Estado: F01 completada; F02-A/B implementados y ambas API activadas y verificadas localmente. Desarrollo está disponible por Wi-Fi con Metro. La distribución del APK de Pruebas espera recuperar HTTPS público; F02-C, F03–F10 y la certificación productiva continúan pendientes.

Revisión 2: acceso principal por teléfono y OTP, Google/Facebook con teléfono verificado y navegación del conductor dentro de la app.

Revisión 3: tres entornos explícitos —desarrollo, pruebas y producción— con aislamiento y promoción controlada de versiones.

Revisión 4: OTP simulado con autocompletado en desarrollo y pruebas, sin envíos SMS ni cargos de un proveedor de OTP.

## 1. Objetivo y decisiones de partida

Lanzar públicamente en **Android, en Bolivia, con taxi, moto y encomiendas**, preparado para incorporar otros países. Incluir pagos **QR al finalizar y efectivo**, comisión por servicio y un **panel administrativo con feature flags**.

La capacidad objetivo será **500 conductores conectados y 5.000 servicios diarios**. Es una meta que debemos comprobar con pruebas; no exige contratar toda esa capacidad desde el primer día.

El proyecto ya tiene negociación, asignación atómica, ciclo del viaje, historial, calificaciones, WebSockets, outbox, Redis y una base de pruebas automatizadas. Los principales pendientes están en seguridad de cuentas, operación comercial, seguimiento GPS, pagos, encomiendas y despliegue.

Decisiones iniciales:

- Activar cobertura por ciudades y zonas desde el panel. Publicar en Bolivia no habilitará automáticamente todo el territorio.
- Mantener el monolito FastAPI y la app actual.
- Operar exactamente tres entornos: **desarrollo**, **pruebas** y **producción**. Pruebas es el entorno de validación previo al lanzamiento, también llamado staging; no es un cuarto entorno.
- Unificar inicio de sesión y registro en **Continuar con teléfono**, sin contraseña para el flujo nuevo: **OTP por SMS real en producción** y **OTP simulado con autocompletado en desarrollo/pruebas**. Google y Facebook serán alternativas opcionales, también sujetas al flujo de verificación del teléfono correspondiente al entorno.
- Ofrecer **navegación giro a giro dentro de ViajaYa con Google Navigation SDK**, hacia la recogida y luego al destino. Waze será una opción externa voluntaria; no sustituye el requisito de navegación integrada.
- Incorporar país, moneda, zona horaria y proveedores configurables. Bolivia comienza con `BO`, `BOB` y `America/La_Paz`.
- Dejar iOS, viajes internacionales y conversión de monedas para fases posteriores.
- Usar las siguientes cifras como orientación presupuestaria; contratar servicios será un hito posterior.

Revisión 5: diez fases de implementación con dependencias, PR sugeridos, evidencia y criterios de cierre. Esta revisión reorganiza el trabajo; no marca funcionalidades como implementadas.

Revisión 6: F01 implementada y verificada en la rama local `codex/phase-01-environments`. Código y comentarios nuevos en inglés; se adopta `testing` y se reserva `test_code` para el contrato OTP de F02. La nube y certificación externa siguen pendientes.

Revisión 7: APK de Desarrollo/Pruebas verificados e instalados por el usuario, con login confirmado en ambas variantes. Pruebas usa temporalmente una API HTTPS en esta PC con recursos separados. F02-A incorpora identidades verificadas, desafíos OTP y formulario reutilizable; su activación en el nuevo acceso corresponde a F02-B. Evidencia: `docs/implementation-plans/0010-phone-identity-and-otp.md`.

Revisión 8: F02-B conecta teléfono/OTP con altas sin correo, transición de cuentas anteriores, sesiones por dispositivo, refresh con rotación/revocación, cambio de número y recuperación auditada. Desarrollo tiene respaldo y migraciones 0024/0025 aplicadas. La revisión automática rechazó reiniciar las API y subir el APK actualizado a EAS; la activación y la instalación esperan autorización. La revisión visual en teléfono sigue pendiente. No se enviaron SMS ni se publicaron commits nuevos.

Verificación de F02-B: 685 pruebas backend y 258 móviles aprobadas; PostgreSQL desechable con 67 aprobadas y 11 omitidas por requisitos de POSIX/Redis. Ruff, TypeScript, lint y contratos aprobados. Metro compiló Android y la imagen Docker quedó preparada. La guía de recorrido está en `local-files/phase02/como-probar-f02b.md`.

Revisión 9: ambas API activadas con respaldo y migraciones, Docker recuperado conservando sus datos y acceso por teléfono verificado contra ambos servicios locales. El usuario autorizó la compilación EAS. Dos túneles de Cloudflare se registraron sin publicar dominios DNS válidos; HTTPS y el APK nuevo siguen pendientes. Se propuso ngrok gratuito con dominio asignado estable, que requiere una cuenta del usuario. Su plan gratuito incluye 1 GB y 20.000 solicitudes HTTP mensuales: es una alternativa de pruebas, con la PC encendida, que debe verificarse antes de usarla. [Límites oficiales de ngrok](https://ngrok.com/docs/pricing-limits/free-plan-limits).

## 2. Hoja de ruta por fases

Cada fase produce una entrega revisable. Los PR sugeridos ordenan unidades de implementación, no representan ramas o PR ya creados. F01 está **Completada localmente**; F02 está **En curso** y F03–F10 permanecen **Pendientes**. La base existente se reutiliza y se verifica. Una fase solo se cierra con su criterio y evidencia, aunque parte del código ya exista.

| Fase | Entrega | Dependencias para cerrar | Estado |
|---|---|---|---|
| F01 | Base técnica y tres entornos | Ninguna; punto de inicio. | Completada localmente |
| F02 | Teléfono, OTP y cuentas sociales | F01. | En curso: A/B locales; activación y C pendientes |
| F03 | Países, panel base y feature flags | F01–F02. | Pendiente |
| F04 | Conductores y operación del viaje | F02–F03. | Pendiente |
| F05 | Seguimiento, mapas y notificaciones | F04. | Pendiente |
| F06 | Navegación del conductor | F05; la prueba de compatibilidad nativa puede adelantarse a F01. | Pendiente |
| F07 | Cobros, comisiones y liquidaciones | F03–F04; puede avanzar en paralelo con F05–F06. Sandbox y contrato del proveedor para cerrar la integración. | Pendiente |
| F08 | Encomiendas completas | F04–F07 para cerrar el recorrido completo; formularios y estados pueden adelantarse. | Pendiente |
| F09 | Certificación productiva y cumplimiento | F01–F08 y disponibilidad de presupuesto/proveedores. Aprovisionar pruebas antes de los ensayos que lo requieran. | Pendiente |
| F10 | Google Play y apertura gradual | F09. La cuenta Play y preparación de la ficha pueden adelantarse. | Pendiente |

**Secuencia principal:** F01 → F02 → F03 → F04 → F05 → F06 → F08 → F09 → F10. F07 parte de F03–F04, puede avanzar junto a F05–F06 y también debe terminar antes de F08. Con una sola persona, usar el orden numérico F01–F10.

**Trabajo anticipable:** preparar cuentas, requisitos de Play y cotizaciones desde F01; adelantar F06-A para comprobar compatibilidad nativa; aprovisionar pruebas cuando haya presupuesto, antes de cualquier certificación que requiera ese entorno. La infraestructura alojada se certifica en F09. Estas tareas conservan el número de su fase y no alteran sus dependencias de cierre.

**Cómo ejecutar y dar seguimiento**

- Tomar una fase y su primer PR pendiente, revisar el código existente y concretar su contrato antes de editar. Si cruza backend/mobile, actualizar ambos y sus pruebas juntos.
- Mantener por fase: estado (Pendiente / En curso / Bloqueada / Completada), responsable, enlaces a PR, evidencia, costo observado y bloqueos. No dar por cerrada una fase por haber fusionado código solamente.
- Cerrar con pruebas proporcionales, migraciones revisadas, demostración del recorrido y riesgos resueltos. F09 reúne la certificación del sistema completo.
- No fijar fechas sin disponibilidad de equipo ni proveedores. Un bloqueo externo impide el cierre correspondiente, pero permite seguir con tareas independientes autorizadas.

### Trabajo comercial y operativo en paralelo

Empieza junto con F01 y no impide preparar el proyecto localmente. Las condiciones/sandbox QR son requisito de cierre de F07; presupuesto, permisos, responsables y proveedores reales son requisitos de F09–F10.

- Registrar las zonas de apertura, servicios disponibles, horarios y responsables de soporte.
- Revisar con asesoría local las condiciones aplicables a transporte, moto, encomiendas, seguros, contratos de conductores, impuestos y facturación.
- Cotizar una pasarela boliviana que permita QR dinámico, consulta de pagos, notificaciones verificables, devoluciones y liquidaciones. Confirmar contractualmente que admite el modelo de cobro y comisión de ViajaYa.
- Definir en configuración comercial el porcentaje de comisión, calendario de liquidación, tratamiento de cancelaciones y límites de deuda por efectivo.
- Preparar cuentas empresariales de proveedores, dominio, correo y Google Play, con accesos recuperables y responsables identificados.
- Certificar la entrega real de OTP con operadores bolivianos mediante una comprobación productiva acotada antes de la apertura, con costo presupuestado; la simulación no certifica entrega SMS. Desarrollo y pruebas nunca llaman al proveedor OTP real. Habilitar países de destino de SMS productivos por configuración, según cobertura comercial, sin asumir entrega mundial.
- Cotizar Google Navigation SDK y validar sus condiciones para una app de movilidad, además de Maps/Places/Routes. Medir el consumo real antes de contratar un compromiso de volumen.

### Fase 01. Base técnica y tres entornos

**Estado:** Completada y verificada localmente. **Rama:** `codex/phase-01-environments`. **Evidencia:** `docs/implementation-plans/0009-environment-foundation.md`. Sin commit/push ni ejecución remota de CI todavía.

**Objetivo:** Preparar una base reproducible y la separación de desarrollo, pruebas y producción antes de añadir funcionalidades.

**Dependencias:** Ninguna; punto de inicio.

**Entregas en orden:**

- [x] F01-A · Configuración validada de los tres entornos y ejemplos sin secretos.
- [x] F01-B · Variantes Android, identidades y destinos de API separados.
- [x] F01-C · Imágenes reproducibles, CI y contratos de proveedores simulados.

**Alcance y decisiones técnicas**

**Tres entornos, tres propósitos**

| Entorno | Propósito y despliegue | Datos e integraciones | App Android |
|---|---|---|---|
| Desarrollo | Trabajo diario en la computadora del desarrollador, API y servicios locales; validar cambios antes de PR | Datos ficticios reiniciables, pagos simulados y OTP simulado con autocompletado, siempre sin proveedor externo | Perfil EAS `development`; nombre ViajaYa Desarrollo e identificador `com.viajaya.app.dev` |
| Pruebas | Entorno alojado y privado para QA, integración entre teléfonos y certificación del candidato; versiones y arquitectura equivalentes a producción con recursos ajustados | Base y caché propias; datos sintéticos, pasarela sandbox y OTP simulado con autocompletado sin SMS ni cargos de proveedor; ensayos de mapas limitados cuando sean necesarios | Perfil EAS `preview`; nombre ViajaYa Pruebas e identificador `com.viajaya.app.testing` |
| Producción | Servicio público para pasajeros, conductores y operación real; únicamente versiones certificadas | Datos reales, pasarela de cobro real, credenciales productivas, backups y monitoreo permanente | Perfil EAS `production`; nombre ViajaYa e identificador `com.viajaya.app` |

Los tres perfiles EAS ya existen en el repositorio. Falta materializar la separación completa de aplicación, infraestructura e integraciones; un perfil de build por sí solo no constituye un entorno aislado. Desarrollo inicia local para contener costos y facilitar el trabajo en Windows; pruebas y producción se despliegan en la nube.

**Aislamiento obligatorio**

- Cada entorno tiene su propia API, PostgreSQL, Redis/Valkey, almacenamiento de documentos, cuentas operativas, flags y secretos. No compartir recursos de datos entre pruebas y producción. La API y el panel de pruebas se restringen al equipo y testers.
- Asignar URLs distintas a API, WebSocket, panel y webhooks; el dominio concreto se configura al contratarlo. El servidor valida su entorno al iniciar y rechaza combinaciones cruzadas o valores locales en producción.
- Separar claves de firma y validación de sesiones, identidades de emisor/audiencia, cuentas de servicio y permisos. Un token de desarrollo o pruebas debe ser rechazado por producción, aunque los números de teléfono sean iguales.
- Separar proyectos/credenciales de Google Maps y Navigation, clientes OAuth, aplicaciones o configuración de prueba de Facebook, claves de pasarela y secretos de webhooks. Configurar firmas Android, redirecciones y cuotas para el identificador correspondiente.
- Aislar OTP, correo y push por entorno. OTP es exclusivamente simulado y autocompletado en desarrollo/pruebas, sin credenciales ni llamadas al proveedor real. Para correo y push, mantener simulaciones/sandbox o destinatarios de prueba autorizados según la integración. Los códigos fijos, autocompletado de prueba, pagos simulados y modos de test deben provocar rechazo de configuración si se intentan activar en producción.
- Mantener destinos de actualización móvil y configuración de runtime separados, ligados a su build y entorno. La app productiva no ofrece un selector de servidor; desarrollo y pruebas tienen nombre distintivo y un indicador de entorno para evitar confusiones, y pueden instalarse junto a producción.
- Promover reglas y versiones de flags de manera explícita; activarlas en pruebas no debe activarlas en producción. Identificar el entorno en registros, errores, alertas, copias de seguridad y métricas de gasto, con accesos y retención propios.
- Usar datos sintéticos; si se necesita reproducir un caso real, anonimizarlo mediante un procedimiento revisado. No copiar datos personales, documentos, tokens ni secretos productivos a desarrollo o pruebas.

**Preparación técnica inicial**

- Crear imágenes y dependencias reproducibles, controles de CI y contratos de configuración de los proveedores. Preparar el modo OTP simulado exclusivamente para desarrollo/pruebas; su flujo y autofill se implementan en F02.
- Declarar infraestructura, URLs, secretos requeridos y promoción sin contratar ni aprovisionar automáticamente servicios de pago. No crear un cuarto entorno.
- Registrar la prueba anticipada de compatibilidad Google Navigation/Expo 56 como tarea F06-A si conviene despejar ese riesgo temprano.

El aislamiento se construye desde F01 y se mantiene en cada fase. La promoción completa se ejecuta y certifica en F09; no se posterga hasta entonces la separación de datos o credenciales.

**Comprobación y evidencia:** Arranque documentado en Windows, validación de configuraciones válidas/inválidas, tokens cruzados rechazados y builds identificables. Ningún secreto se incorpora al repositorio.

**Criterio de cierre de F01:** Desarrollo funciona de forma reproducible; CI comprueba aislamiento y rechazo de configuraciones inseguras. Las variantes y definiciones de despliegue de pruebas/producción quedan preparadas; su alojamiento se verifica antes de cerrar F09.

**Costo o dependencia externa:** Puede comenzar localmente sin contratar nube ni SMS. Preparar despliegues no significa que ya existan tres entornos alojados.

**Verificación registrada (09/09/2026):** 649 pruebas backend aprobadas; 69 pruebas opt-in PostgreSQL/Redis omitidas. 235 pruebas mobile, Ruff, TypeScript, lint y contratos aprobados. Tres proyectos Android generados, bundle Hermes compilado, imagen Docker construida y smoke contra PostgreSQL desechable aprobado. Configuración Compose y workflow validados.

**Límites de la entrega:** la generación nativa y el bundle no certifican APK/AAB firmados en teléfonos. No hay nube contratada ni OTP implementado en pantalla todavía; su flujo corresponde a F02. Los tokens anteriores sin emisor/audiencia requieren iniciar sesión nuevamente.

### Fase 02. Teléfono, OTP y cuentas sociales

**Estado:** En curso; F02-A/B y ambas API verificadas localmente, HTTPS público y APK de Pruebas pendientes. **Responsable:** implementación asistida en esta tarea. **PR:** no publicado. **Evidencia:** `docs/implementation-plans/0010-phone-identity-and-otp.md`.

**Objetivo:** Permitir entrar o registrarse con teléfono y OTP, con Google/Facebook opcionales y recuperación sin bloqueos.

**Dependencias:** F01.

**Entregas en orden:**

- [x] F02-A · Identidad estable, desafío OTP y formulario con autofill simulado, verificados en aislamiento. Activación en el acceso unificado: F02-B.
- [x] F02-B · Código del flujo móvil unificado, sesiones, cambio de número y recuperación de acceso.
- [x] F02-B · Activar ambas API y verificar OTP, cuentas y sesiones contra los servicios locales.
- [ ] F02-B · Recuperar HTTPS público, compilar/instalar el APK de Pruebas autorizado y recorrerlo en teléfono.
- [ ] F02-C · Google/Facebook, vinculación y migración de cuentas existentes.

**Alcance y decisiones técnicas**

- Reemplazar las pantallas separadas de login/registro por **Continuar con teléfono**, con selector de país y prefijo +591 inicial. Normalizar a E.164; admitir números extranjeros cuando el proveedor y la configuración lo permitan.
- Flujo principal: **teléfono → código OTP → cuenta existente o completar nombre y términos → inicio**. El código llega por SMS en producción y se simula/autocompleta en desarrollo y pruebas. No pedir correo ni contraseña para usar este acceso. Resolver la existencia de la cuenta después de verificar el código, con respuestas que no permitan enumerar teléfonos registrados.
- Mantener **Continuar con Google** y **Continuar con Facebook**. El backend verifica la identidad del proveedor y, en el primer acceso sin teléfono verificado, solicita **número → OTP → completar datos/términos**. La identidad social por sí sola no permite pedir viajes ni conducir.
- Una sesión válida se conserva al reabrir la app. No enviar un SMS en cada apertura ni en cada viaje. Volver a verificar al cambiar el número, recuperar acceso o cuando una comprobación de seguridad lo exija.
- Modelar una cuenta interna estable y varias identidades vinculadas. El teléfono verificado debe ser único entre cuentas activas. Vincular Google/Facebook solo con confirmación explícita y prueba de ambas identidades; no fusionar por coincidencia de correo ni por un teléfono histórico sin verificar.
- Guardar desafíos OTP con caducidad, uso único, número, finalidad e identificador de proveedor. Limitar intentos, reenvíos y solicitudes por número, IP y dispositivo; contemplar códigos incorrectos, vencidos, SMS retrasados y errores del proveedor. No guardar códigos ni tokens en logs.
- Emitir credenciales operativas solo tras la verificación requerida; el alta debe ser idempotente para evitar duplicados ante reintentos o solicitudes simultáneas. Incorporar sesiones por dispositivo, rotación de refresh, detección de reutilización y revocación HTTP/WS.
- Permitir editar y verificar un nuevo número mediante reautenticación; revocar sesiones cuando corresponda. Si se pierde el número, ofrecer recuperación asistida y auditada, considerando números reciclados o cuentas en conflicto. En F02 se implementan la solicitud, el caso de uso protegido y su auditoría; la herramienta del operador y su recorrido completo se cierran con el panel en F03-B.
- Migrar usuarios actuales conservando ID, historial, rol y ganancias. Exigir prueba de acceso a la cuenta anterior y OTP antes de vincular el teléfono. No elevar roles durante el alta; los conductores mantienen la aprobación de F04.
- Retirar correo/contraseña del flujo móvil nuevo. Mientras exista un acceso antiguo para migración, corregir su truncamiento a 72 bytes y no aceptar credenciales ambiguas sin recuperación. Al cerrar la transición, deshabilitar esos endpoints; no construir un nuevo flujo de contraseñas para usuarios nuevos.
- Mantener la autenticación reforzada del panel administrativo; el acceso sencillo de pasajeros y conductores no elimina ese requisito. Conservar límites contra abuso en ofertas, solicitudes y WS, y tiempos de espera en verificaciones externas.


**OTP sin costo de proveedor en ambientes bajos**

- En **desarrollo y pruebas**, usar siempre un adaptador OTP simulado dentro del backend, sin llamadas de envío ni de verificación a Twilio u otro proveedor externo. Estos despliegues no reciben credenciales del proveedor SMS; no existe fallback a envíos reales si falla el simulador.
- Generar un código de prueba por desafío y conservar las mismas comprobaciones de finalidad, teléfono, caducidad, intentos y uso único del flujo normal. Evitar un código universal que permita saltarse la verificación.
- Solo el backend de un entorno bajo puede devolver el campo `test_code` en la respuesta del desafío. La variante móvil de ese entorno rellena automáticamente el formulario y muestra **OTP de prueba · sin SMS**. El usuario pulsa Continuar y el backend verifica el desafío; autocompletar no equivale a iniciar sesión automáticamente.
- Permitir desactivar el autocompletado en desarrollo/pruebas para ingresar códigos erróneos y ensayar caducidad, reenvíos, límites y fallos simulados del proveedor. Los reintentos siguen siendo locales y gratuitos respecto al proveedor OTP.
- Aplicar esta simulación al acceso por teléfono, al paso OTP posterior a Google/Facebook y a las verificaciones de cambio de número/recuperación. Toda cuenta y verificación obtenida así permanece en su entorno aislado.
- Seleccionar el modo por configuración de despliegue validada al iniciar, no por parámetros enviados por la app ni por una flag comercial que pueda activarse en producción. El servidor productivo rechaza la configuración simulada, no devuelve `test_code` y no acepta desafíos ni tokens de entornos bajos. El build productivo excluye la ayuda de autocompletado de prueba.
- El autocompletado que el sistema operativo pueda ofrecer a partir de un SMS real en producción es independiente: ese SMS sí puede generar cargos. Aquí el ahorro se obtiene porque en ambientes bajos no se envía ni verifica nada con un proveedor externo.

**Aceptación:** se completa el flujo OTP de desarrollo/pruebas con el campo autocompletado y **cero llamadas al proveedor externo**; producción conserva verificación real y no expone códigos de prueba. El costo de cómputo/hosting del simulador permanece dentro del presupuesto del entorno.

**Comprobación y evidencia:** OTP incorrecto, vencido y reutilizado; reenvíos; pérdida de sesión; altas concurrentes; vinculación social y migración conservando ID, rol e historial. Ausencia de test_code en el contrato productivo.

**Criterio de cierre de F02:** Alta, acceso y recuperación por autoservicio funcionan sin cuentas duplicadas ni cambios de rol. La recuperación asistida tiene solicitud, caso de uso y auditoría probados; su panel se cierra en F03. Entornos bajos hacen cero llamadas OTP y producción rechaza la simulación; SMS real se certifica en F09.

**Costo o dependencia externa:** OTP de desarrollo/pruebas: cero cargos externos. Las cuentas OAuth y el adaptador real se preparan aquí; reservar presupuesto para certificar SMS productivo en F09.

### Fase 03. Países, panel base y feature flags

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Controlar el acceso administrativo y la disponibilidad por territorio, dejando preparada la expansión internacional.

**Dependencias:** F01–F02.

**Entregas en orden:**

- [ ] F03-A · País, zona, moneda y horario; Bolivia como configuración inicial.
- [ ] F03-B · Panel base, acceso reforzado, roles, auditoría y recuperación asistida.
- [ ] F03-C · Flags de backend y capacidades consumidas por la app.

**Alcance y decisiones técnicas**

**Territorios y moneda**

- Sustituir las reglas fijas de Bolivia por un catálogo de países y zonas.
- Asociar viajes, ofertas, pagos y liquidaciones con su zona y moneda.
- Mantener importes decimales; impedir sumar o liquidar monedas diferentes.
- Guardar fechas en UTC y calcular jornadas operativas según la zona horaria correspondiente.
- Normalizar teléfonos internacionales, permitiendo que un visitante extranjero use ViajaYa en Bolivia.
- Separar proveedores de pagos, mensajería y requisitos documentales por mercado.

**Panel base y capacidades**

Crear la estructura del panel web interno y completar ahora países, zonas y permisos:

- Administrar países, zonas, servicios y disponibilidad.
- Preparar el contrato de indicadores; conectar operación en F04–F05 y gasto/finanzas en F07–F09.

Implementar permisos separados para administración, soporte y finanzas, autenticación reforzada y registro de quién cambió qué.

- Incorporar la herramienta de recuperación asistida sobre el contrato de F02, con autorización, revocación de sesiones y auditoría. Certificar aquí el recorrido completo entre usuario y operador.

Las flags se evaluarán en el backend y permitirán habilitar servicios, métodos de pago y funciones por país, ciudad y grupo de usuarios. La app recibirá la configuración para presentar las opciones disponibles.

Incluir flags para Google/Facebook, países autorizados para SMS, navegación Google integrada y alternativa Waze. Si falla el servicio OTP, pausar altas/accesos que requieran verificación y ofrecer reintento; nunca omitir la comprobación como fallback. Los cambios de navegación tampoco deben cortar una guía ni un viaje ya iniciados.

**Apagar una función bloqueará operaciones nuevas y permitirá terminar los viajes y pagos existentes.** Los parámetros internos de Redis, outbox y scheduler conservarán su procedimiento técnico de despliegue.

**Comprobación y evidencia:** Permisos por rol y zona, importes decimales, horarios, teléfonos internacionales y flags apagadas durante un viaje activo. Los módulos operativos y financieros se completan en F04 y F07.

**Criterio de cierre de F03:** Una zona se habilita con permisos y auditoría; apagar una función conserva operaciones activas. El panel completa la recuperación asistida de F02. La estructura admite otro país sin mezclar monedas.

**Costo o dependencia externa:** Puede desarrollarse con datos sintéticos y panel local; el catálogo no activa comercialmente ningún país nuevo.

### Fase 04. Conductores y operación del viaje

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Habilitar conductores aprobados y resolver la operación normal y excepcional del viaje desde app y panel.

**Dependencias:** F02–F03.

**Entregas en orden:**

- [ ] F04-A · Alta, documentos privados, revisión y suspensión del conductor.
- [ ] F04-B · Elegibilidad, disponibilidad, cobertura y recogida verificada.
- [ ] F04-C · Cancelaciones, incidentes y herramientas de soporte auditadas.

**Alcance y decisiones técnicas**

- Incorporar solicitud de alta, carga privada de documentos, revisión, aprobación, rechazo, suspensión y vencimientos.
- Permitir recibir solicitudes únicamente a conductores aprobados, disponibles y habilitados para ese servicio y zona.
- Filtrar solicitudes por cercanía y cobertura; limitar los datos personales y ubicaciones exactas expuestos antes de la asignación.
- Implementar motivos de cancelación, pasajero ausente, incidentes y resolución de viajes atascados.
- Ofrecer soporte desde el viaje y el historial, con un procedimiento humano de atención.
- Incorporar identificación del vehículo y verificación de recogida para reducir errores de pasajero o encomienda.

**Módulo operativo del panel**

- Revisar conductores, documentos y vehículos.
- Consultar viajes e incidentes y resolver operaciones excepcionales mediante acciones auditadas. Los cobros, liquidaciones y comisiones pendientes se incorporan en F07.
- Conectar indicadores operativos y el procedimiento de atención humana.

**Comprobación y evidencia:** Documento vencido, suspensión, conductor fuera de zona, cancelación, ausencia e incidente. Matching conserva asignación atómica y reglas actuales.

**Criterio de cierre de F04:** Solo conductores aprobados y elegibles reciben solicitudes; soporte resuelve incidentes sin editar la base de datos y se limita la información expuesta antes de asignar.

**Costo o dependencia externa:** El software puede probarse localmente. La apertura necesitará personas para revisión de documentos, soporte y operación.

### Fase 05. Seguimiento, mapas y notificaciones

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Mantener ubicación y estado del viaje confiables para pasajero y conductor, con mapas y consumo controlados.

**Dependencias:** F04.

**Entregas en orden:**

- [ ] F05-A · Reporte GPS autorizado, precisión y aviso de ubicación antigua.
- [ ] F05-B · Continuidad Android, recuperación realtime y notificaciones.
- [ ] F05-C · Maps/Places/Routes desde backend, errores, cuotas y métricas.

**Alcance y decisiones técnicas**

- Enviar ubicación del conductor con hora y precisión; mostrar su posición real al pasajero autorizado.
- Detectar posiciones antiguas y comunicar pérdida de señal.
- Mantener seguimiento durante el servicio con los permisos y mecanismos Android apropiados; detenerlo al finalizar o quedar fuera de servicio.
- Añadir push para aceptación, llegada, cancelación y novedades relevantes. Al abrir una notificación, consultar el estado actual.
- Conservar la caducidad de ofertas de **30 segundos** y la gracia de presencia del pasajero de **120 segundos**.
- Llevar las consultas HTTP propias de Places, Routes y geocodificación al backend autenticado, con límites, cancelación y tiempos de espera. El Navigation SDK nativo se integra en Android y usa sus mecanismos de conexión y credenciales restringidas; no se convierte en una consulta HTTP del backend.
- Separar credenciales nativas y de servidor, restringiéndolas por aplicación, firma y API según corresponda; controlar campos solicitados y recálculos.
- Mostrar errores de rutas explícitamente.

- Conservar WebSocket como vía principal, recuperación por snapshot y polling como respaldo lento. La cancelación automática por ausencia solo afecta viajes SEARCHING; el GPS del conductor no modifica esta regla.

**Comprobación y evidencia:** Dos teléfonos, permisos denegados, GPS antiguo, red lenta, reconexión y push que recupera el snapshot. La cancelación por ausencia solo afecta SEARCHING.

**Criterio de cierre de F05:** El seguimiento se recupera tras desconexión, segundo plano y cambio de app; conserva ofertas de 30 segundos y presencia del pasajero de 120 segundos.

**Costo o dependencia externa:** Usar dobles en automatización y limitar ensayos reales de mapas. No confundir OTP gratuito en entornos bajos con gratuidad de Google Maps.

### Fase 06. Navegación del conductor

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Guiar dentro de ViajaYa hacia recogida y destino con Google Navigation, manteniendo Waze como opción externa.

**Dependencias:** F05; la prueba de compatibilidad nativa puede adelantarse a F01.

**Entregas en orden:**

- [ ] F06-A · Validar wrapper, Expo 56 y build Android reproducible.
- [ ] F06-B · Guía integrada, voz, ETA, desvíos y cambio de etapa.
- [ ] F06-C · Recuperación, Waze opcional y medición de solicitudes cobrables.

**Alcance y decisiones técnicas**

**Navegación del conductor dentro de ViajaYa**

- Incorporar Google Navigation SDK con instrucciones giro a giro, voz, distancia, ETA y recálculo por desvíos. Cubrir **conductor → recogida** y **recogida → destino** para taxi, moto y encomiendas, usando el modo de vehículo disponible y validado en cada país.
- La pantalla conserva las acciones necesarias del viaje con controles grandes y poca interacción. Cambiar de etapa solo tras la confirmación de recogida/inicio correspondiente; un evento de llegada del SDK no completa automáticamente el servicio ni confirma su pago.
- Usar el viaje activo del backend como fuente de destinos y estado. Reanudar la etapa correcta al volver a la app y evitar volver a solicitar destinos por cada render, muestra GPS o reconexión; medir las llamadas que generan cargos.
- Mantener el reporte GPS a ViajaYa y la autorización por participantes. La navegación de Google no sustituye el seguimiento que ve el pasajero ni la presencia del sistema realtime.
- Certificar GPS denegado o desactivado, red perdida, falta de ruta, cuota o credencial inválida, voz, Bluetooth, bloqueo de pantalla y regreso desde segundo plano. Mostrar acciones de recuperación; no prometer navegación offline completa sin comprobar el soporte real.
- Realizar primero una prueba de integración con **Expo 56 y React Native 0.85.3**, build Android firmado y los mapas existentes. El wrapper de Google es beta y sus requisitos cambian: seleccionar una versión compatible y verificar dependencias nativas antes de fijarla, sin actualizar Expo/RN a ciegas. Generar un nuevo binario con la integración y configuración reproducible. [Wrapper oficial de Google](https://github.com/googlemaps/react-native-navigation-sdk), [desarrollo nativo en Expo](https://docs.expo.dev/workflow/customizing/).
- Validar rutas reales de las zonas bolivianas, funciones de moto disponibles, permisos, términos y atribuciones. No anunciar funciones sin cobertura comprobada. [Cobertura de Navigation SDK](https://developers.google.com/maps/documentation/navigation/android-sdk/coverage-nav-sdk).

**Waze como alternativa externa**

- Ofrecer **Abrir en Waze** mediante deep link, iniciado por el conductor y con el destino de la etapa actual. El SDK público de Waze no permite incrustar su mapa y navegación dentro de ViajaYa. [Limitaciones oficiales](https://developers.google.com/waze/intro-transport), [deep links](https://developers.google.com/waze/deeplinks).
- Si Waze no está instalado, ofrecer continuar con Google integrado. Al volver, recuperar el viaje activo. No ejecutar dos guías por voz a la vez; mantener el seguimiento autorizado de ViajaYa mientras el conductor usa Waze.
- No asumir que un deep link devuelve ubicación, ruta o ETA de Waze; una eventual integración de socio requeriría acceso y validación aparte. Waze es opcional y no cumple por sí solo el criterio de navegación dentro de la app.


La ubicación con la app minimizada debe justificarse y declararse conforme a los [requisitos de Google Play](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en).

**Comprobación y evidencia:** Taxi, moto y encomienda en zonas objetivo; GPS/red/credenciales fallidos, Bluetooth, pantalla bloqueada, Waze instalado/ausente y regreso a la etapa correcta.

**Criterio de cierre de F06:** Un recorrido real completa las dos etapas con guía integrada, una sola voz y seguimiento del pasajero. La llegada del SDK no completa el viaje ni su pago; no hay solicitudes duplicadas por render o reconexión.

**Costo o dependencia externa:** La prueba real necesita cuenta Google y presupuesto limitado. Si la integración beta no es compatible, resolver el bloqueo antes de comprometer la funcionalidad; no sustituirla silenciosamente por Waze.

### Fase 07. Cobros, comisiones y liquidaciones

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Registrar y conciliar QR y efectivo, con comisiones, deuda del conductor y liquidaciones trazables.

**Dependencias:** F03–F04; puede avanzar en paralelo con F05–F06. Sandbox y contrato del proveedor para cerrar la integración.

**Entregas en orden:**

- [ ] F07-A · Importes, comisión congelada, registro contable y efectivo.
- [ ] F07-B · QR, verificación del proveedor, webhooks e idempotencia.
- [ ] F07-C · Deuda, devoluciones, conciliación, liquidaciones y panel financiero.

**Alcance y decisiones técnicas**

Actualmente seleccionar “QR” no procesa una transacción. Hace falta el circuito completo:

- Separar estado del servicio y estado del pago: terminar un viaje no significa haber cobrado.
- Generar un QR por obligación de pago, con importe, moneda, referencia y vencimiento.
- Confirmar pagos desde el proveedor; manejar notificaciones duplicadas, tardías y reintentos sin duplicar cobros.
- Guardar la tarifa y regla de comisión aplicadas al aceptar el servicio.
- Implementar un registro contable auditable de cobros, comisiones, devoluciones, ajustes y liquidaciones.
- En efectivo, registrar la declaración de cobro del conductor y la comisión adeudada, con posibilidad de reclamo.
- Compensar comisiones pendientes contra liquidaciones QR y permitir su pago por QR.
- Aplicar límites configurables de deuda a nuevas operaciones, conservando la finalización de servicios activos.
- Conciliar diariamente los registros con el proveedor y disponer de una cola de diferencias para finanzas.
- Sustituir la billetera vacía por pantallas reales de pagos y liquidaciones.

**Módulo financiero del panel**

- Consultar cobros, liquidaciones y comisiones pendientes con permisos de finanzas.
- Resolver diferencias, reclamos y ajustes mediante acciones auditadas; conectar indicadores de operación y gasto.
- Construir primero efectivo y registro contable, después QR y por último conciliación/deuda/liquidaciones; mantener contratos backend/mobile en cada PR.

**Comprobación y evidencia:** Notificaciones duplicadas/tardías, QR vencido, efectivo disputado, límites de deuda, devolución y liquidación fallida; conciliación sin duplicar dinero.

**Criterio de cierre de F07:** Cada importe se explica desde el servicio hasta el cobro, comisión y liquidación tras reintentos o caídas. La integración QR supera el sandbox del proveedor; los cobros reales se certifican en F09.

**Costo o dependencia externa:** Modelo y adaptadores simulados pueden avanzar sin contrato. Cotizar comisión de pasarela, devoluciones y liquidaciones antes de cerrar la integración.

### Fase 08. Encomiendas completas

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Completar retiro, transporte, entrega y resolución de excepciones de paquetes con trazabilidad operativa y financiera.

**Dependencias:** F04–F07 para cerrar el recorrido completo; formularios y estados pueden adelantarse.

**Entregas en orden:**

- [ ] F08-A · Remitente, destinatario, paquete y restricciones.
- [ ] F08-B · Retiro, entrega y comprobación de recepción.
- [ ] F08-C · Ausencias, devoluciones e incidentes con ajustes auditados.

**Alcance y decisiones técnicas**

- Añadir remitente, destinatario, teléfonos, descripción y límites del paquete.
- Informar artículos restringidos y condiciones del servicio.
- Registrar retiro, entrega y comprobación de recepción mediante código.
- Resolver destinatario ausente, entrega fallida, devolución e incidentes.
- Asociar cualquier ajuste de cobro con una causa y aprobación auditables.

**Comprobación y evidencia:** Retiro correcto, código de entrega incorrecto/reutilizado, destinatario ausente, devolución y ajuste de cobro autorizado.

**Criterio de cierre de F08:** Una encomienda se entrega o resuelve excepcionalmente desde app y panel; quedan registrados estado, comprobación, responsabilidad e importes aplicables.

**Costo o dependencia externa:** Validar condiciones, artículos restringidos, responsabilidad y operación de devoluciones con el frente comercial antes de abrir.

### Fase 09. Certificación productiva y cumplimiento

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Certificar el candidato completo en infraestructura alojada y comprobar seguridad, recuperación, costos y cumplimiento.

**Dependencias:** F01–F08 y disponibilidad de presupuesto/proveedores. Aprovisionar pruebas antes de los ensayos que lo requieran.

**Entregas en orden:**

- [ ] F09-A · Infraestructura alojada, promoción, migraciones y observabilidad.
- [ ] F09-B · Integración, aislamiento, carga, restauración y rollback.
- [ ] F09-C · Privacidad, eliminación y certificación real de proveedores.

**Alcance y decisiones técnicas**

Arquitectura inicial propuesta: **Render de pago**, con API permanente, PostgreSQL administrado con réplica de disponibilidad, Redis/Valkey privado y panel estático. Validar la latencia desde redes móviles bolivianas antes de fijar región; Render actualmente no ofrece región sudamericana. [Regiones disponibles](https://render.com/docs/regions).

- Separar desarrollo, pruebas y producción conforme al aislamiento y flujo de promoción definidos en F01 y en el flujo siguiente.
- Crear imágenes reproducibles y despliegue automatizado con HTTPS/WSS.
- Ejecutar migraciones mediante un único proceso y comprobar compatibilidad antes de actualizar.
- Validar configuración productiva: secretos, conexiones y URLs; rechazar valores locales o inseguros.
- Completar la promoción gradual del sistema realtime existente y certificar dos réplicas.
- Centralizar errores de backend y Android, registros sanitizados, métricas y alertas con destinatario real.
- Proteger métricas y herramientas administrativas.
- Configurar backups, recuperación a un momento determinado y copia externa; ensayar restauración y rollback.
- Fijar versiones de dependencias, escaneo de secretos y controles obligatorios para integrar cambios.

**Promoción de versiones: desarrollo → pruebas → producción**

- Desarrollo: implementar en una rama y enviar PR. CI ejecuta contratos y pruebas sobre bases temporales desechables; estas bases son recursos de test, no un cuarto entorno permanente.
- Pruebas: desplegar el candidato identificado por commit y versión, aplicar migraciones y ejecutar QA funcional, OTP simulado con autocompletado, OAuth, pagos sandbox, navegación, realtime y comprobaciones de aislamiento. Ensayar cambios de esquema, restauración y rollback antes de promoverlos.
- Producción: promover la misma imagen backend certificada, con configuración y secretos de producción. Ejecutar migraciones compatibles mediante un único proceso y comprobar salud; conservar la imagen anterior para rollback. No ejecutar suites destructivas o seeds de pruebas sobre datos reales.
- Android: generar las variantes de entorno desde el mismo commit. Como sus identificadores y credenciales son diferentes, certificar también el AAB productivo firmado en la pista interna/cerrada de Google Play antes de promover ese mismo AAB al público. Una pista de distribución no cambia automáticamente la API a la que apunta el binario.
- Registrar versión, entorno, resultado de pruebas y responsable de promoción. El despliegue público queda bloqueado si fallan las comprobaciones, existen secretos cruzados o quedan simulaciones activadas. Los cambios nativos requieren un binario compatible; las actualizaciones móviles no deben cruzar entornos.

**Privacidad y certificación de proveedores**

- Publicar términos, privacidad, soporte y condiciones de conductores.
- Guardar aceptación versionada de términos.
- Implementar solicitud de eliminación, anonimización y reglas de conservación por categoría.
- Proporcionar eliminación desde la app y una vía web accesible: Google Play exige ambas para aplicaciones que crean cuentas. [Política de eliminación](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN).
- Certificar Google/Facebook con las firmas y credenciales de producción.
- Ejecutar la certificación técnica y de cumplimiento de la sección 5 y registrar evidencia del candidato, entorno y versión. Los hitos de distribución, revisión y aceptación de Google Play se cierran en F10 y no son requisitos de cierre de F09.
- Certificar OTP real exclusivamente en producción mediante un ensayo acotado y presupuestado; desarrollo/pruebas mantienen siempre la simulación. Certificar OAuth con firmas productivas y QR real con su proveedor.
- Confirmar costos medidos, responsables, contratos y límites antes de autorizar la apertura.

**Comprobación y evidencia:** Informe de la matriz de certificación, alerta recibida, restauración RPO ≤ 15 min/RTO ≤ 2 h, API p95 ≤ 500 ms y realtime p95 ≤ 2 s bajo la carga objetivo; ensayo de eliminación y retención.

**Criterio de cierre de F09:** Pruebas y producción están alojados y aislados; el candidato supera integración, carga y recuperación. OTP/OAuth/QR/Navigation reales, condiciones comerciales, privacidad y presupuesto de apertura tienen evidencia.

**Costo o dependencia externa:** Requiere gasto real en hosting y ensayos acotados de proveedores. Con presupuesto cero esta fase no se declara completa ni se abre al público.

### Fase 10. Google Play y apertura gradual

**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.

**Objetivo:** Publicar el AAB certificado y abrir zonas de Bolivia con taxi, moto y encomiendas operativos y bajo seguimiento.

**Dependencias:** F09. La cuenta Play y preparación de la ficha pueden adelantarse.

**Entregas en orden:**

- [ ] F10-A · AAB firmado, ficha, Data Safety, permisos y revisión de Play.
- [ ] F10-B · Prueba interna/cerrada aplicable e instalación/actualización.
- [ ] F10-C · Apertura por zonas, soporte, conciliación y revisión de métricas.

**Alcance y decisiones técnicas**

- Completar Data Safety, declaraciones de permisos, ficha, capturas y acceso para revisión.
- Generar y probar el AAB firmado sin depender de Metro.
- Comprobar si aplica la prueba cerrada de 12 participantes durante 14 días, exigida a determinadas cuentas personales nuevas. [Requisitos de pruebas](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB).

- Promover el mismo AAB productivo certificado internamente; cambiar de pista no cambia la API del binario.
- Abrir zonas gradualmente mediante flags, con taxi, moto y encomiendas listos, conductores aprobados, soporte y conciliación disponibles.
- Observar errores, disponibilidad, pagos y costo por servicio; si se detiene una apertura, bloquear nuevas operaciones conservando viajes y obligaciones en curso.
- Ampliar cobertura o capacidad según estabilidad, demanda y costo observado. Un país nuevo lleva su propia certificación local.

**Comprobación y evidencia:** Registro de aprobación y versión, resultados en teléfonos, checklist de zona, responsables de incidencias y seguimiento de errores, pagos y costo por servicio.

**Criterio de cierre de F10:** Google Play acepta el binario; se promueve el mismo AAB productivo certificado. Cada zona habilitada tiene conductores aprobados, soporte, conciliación, alertas y límites de gasto activos.

**Costo o dependencia externa:** Abrir gradualmente por geografía contiene exposición y gasto; los tres servicios acordados deben estar listos. Expandir países requiere una certificación independiente.

### Primer bloque completado: F01-A

- [x] Inventariar la configuración actual de backend, mobile, Docker y EAS; identificar valores fijos y documentación activa. Usar ejemplos sin leer ni modificar secretos de los archivos .env.
- [x] Definir el contrato de entorno y su validación: desarrollo/pruebas/producción, URLs, emisor/audiencia, credenciales por proveedor y modos permitidos.
- [x] Documentar la matriz OTP: simulación obligatoria en desarrollo/pruebas, proveedor real exclusivamente en producción; el autofill llega en F02.
- [x] Actualizar configuración y ejemplos de ambos proyectos y comprobar aceptación de combinaciones válidas y rechazo de cruces/modos inseguros.
- [x] Registrar evidencia local: F01-A, F01-B y F01-C completadas; continuar con F02-A. Este bloque no contrata nube ni requiere activar SMS.

## 3. Contratos y compatibilidad

Cada bloque transversal actualizará backend y mobile conjuntamente:

| Contrato | Incorporación |
|---|---|
| Autenticación | Solicitud/verificación de OTP, alta unificada por teléfono, identidades Google/Facebook, vinculación, cambio de número, sesiones, recuperación y revocación |
| Configuración | Países, zonas, moneda, servicios, países SMS, navegación integrada/externa y capacidades habilitadas |
| Conductores | Solicitudes, documentos, aprobación y elegibilidad |
| Viajes y tiempo real | Ubicación autorizada, etapa/destino de navegación, ETA, incidentes y datos de encomiendas |
| Dinero | Pagos, comisiones, deuda, devoluciones y liquidaciones |
| Administración | Acciones protegidas, permisos y auditoría |

Mantener `/api/v1`, DTO en `snake_case`, mapeo mobile y pruebas de contratos. Los cambios de esquema llevarán migraciones revisadas y una transición compatible con versiones de la app que aún estén instaladas.

La respuesta OTP de desarrollo/pruebas puede incluir `test_code` para el autocompletado. El contrato productivo no incluye ese campo; CI debe certificar su ausencia y el rechazo de cualquier solicitud que intente activar el modo simulado desde el cliente.

## 4. Presupuesto y control del gasto

**Conviene separar el costo fijo de mantener el servicio del costo variable de cada operación.** Sin presupuesto definido, estas referencias permiten decidir cuándo contratar y cuánto reservar.

Estimaciones mensuales en USD, con precios consultados el **9 de septiembre de 2026**:

| Concepto | Apertura acotada | Preparación para la capacidad objetivo |
|---|---:|---:|
| Infraestructura de pruebas y producción, backups y monitoreo | **300–400** | **700–1.000** |
| Mapas | Según búsquedas y rutas | Puede superar al costo de infraestructura |
| Navegación Google integrada | Según destinos solicitados al SDK | Ejemplo de dos destinos por viaje: USD 6.475/mes |
| OTP en desarrollo y pruebas | **0 USD de envío/verificación externa**, mediante simulación y autocompletado | **0 USD de envío/verificación externa**; hosting contabilizado aparte |
| OTP real en producción | Según altas, inicios que requieran OTP, cambios de número y reintentos | Según consumo y país; no equivale a SMS por viaje |
| Correo transaccional | Según proveedor y volumen | Según proveedor y volumen |
| Pasarela y liquidaciones | Según contrato y volumen cobrado | Según contrato y volumen cobrado |
| Desarrollo, soporte, seguros y obligaciones comerciales | Presupuesto separado | Presupuesto separado |

Las bandas de infraestructura son estimaciones propias basadas en producción con dos réplicas API, PostgreSQL con disponibilidad y caché privada, más un entorno de pruebas alojado. Desarrollo se ejecuta localmente y no suma otro despliegue permanente en nube; su equipo, conectividad y uso de APIs se presupuestan aparte. Pruebas ya estaba incluido como staging, por lo que esta aclaración no añade un tercer cargo de hosting a las bandas anteriores. **No garantizan capacidad** y deben ajustarse con mediciones. [Precios de Render](https://render.com/pricing).

Para dimensionar mapas: **5.000 viajes/día × 30 días × 2 rutas = 300.000 cálculos mensuales**, aproximadamente **USD 1.250 en Routes Essentials**. Añadiendo, como hipótesis, un detalle Essentials y cinco solicitudes de autocompletado por viaje, el conjunto sería aproximadamente **USD 3.488/mes**, antes de geocodificación, búsquedas abandonadas y recálculos adicionales. [Tarifas de Google Maps](https://developers.google.com/maps/billing-and-pricing/pricing).

Ese escenario base daría **unos USD 4.200–4.500 mensuales entre infraestructura y mapas, sin navegación giro a giro**. No representa el presupuesto completo del alcance actualizado.

**Costo adicional de navegación integrada.** A 5.000 viajes/día durante 30 días, un destino de navegación por viaje suma 150.000 destinos (aproximadamente **USD 3.475/mes**); dos destinos, recogida y entrega, suman 300.000 (aproximadamente **USD 6.475/mes**). Con el supuesto conservador de conservar las consultas de mapas anteriores, infraestructura + mapas + dos destinos de navegación serían **unos USD 10.700–11.000/mes**, antes de SMS, pasarela, impuestos y operación humana. Son escenarios de uso a tarifa pública, no una cotización ni el costo de empezar. [Tarifas de Navigation Request](https://developers.google.com/maps/billing-and-pricing/pricing).

La facturación depende de destinos solicitados y del contrato; iniciar la guía y los desvíos automáticos posteriores no tienen un cargo adicional por sí mismos. Evitar consultas duplicadas entre Routes y el SDK y medir si la integración permite reducir el supuesto anterior. Pedir condiciones de movilidad/volumen sin asumir descuentos. [Facturación de Navigation SDK](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing).

Otros consumos que deben quedar visibles:

- Verificación real en producción: Twilio Verify publica USD 0,05 por verificación exitosa **más el costo del canal**; 1.000 verificaciones serían USD 50 antes del SMS aplicable a Bolivia. Cotizar entrega y tarifa local antes de elegir proveedor. Desarrollo y pruebas no consumen este servicio. [Precios de Verify](https://www.twilio.com/en-us/verify/pricing).
- Compilaciones y actualizaciones: EAS tiene nivel gratuito y Starter de USD 19/mes más consumo. Elegir según uso real. [Precios de Expo](https://expo.dev/pricing).
- Cobros: calcular comisiones de pasarela, liquidaciones y devoluciones sobre el contrato real; no asumir que recibir QR es gratuito.

Implementar en pruebas y producción, con medición y límites separados:

- Indicadores de costo por entorno, búsqueda, viaje, destino de navegación y país. Medir envío/verificación OTP, entrega y reintentos SMS solo para producción; en desarrollo/pruebas registrar desafíos simulados y comprobar cero llamadas al proveedor externo.
- Alertas al 50 %, 80 % y 100 % del presupuesto configurado.
- Cuotas y límites de consumo, además de alertas: una alerta presupuestaria por sí sola no detiene cargos. [Control de costos de Maps](https://developers.google.com/maps/billing-and-pricing/manage-costs).
- Control de abuso, campos mínimos de Places y límites de recálculo.
- Margen por servicio: **comisión ingresada menos pasarela, consumo tecnológico, ajustes y devoluciones**.

## 5. Pruebas y condiciones para abrir al público

Ejecutar cada fase mediante los PR sugeridos y comprobar sus criterios antes de cerrarla. La siguiente matriz es transversal: cada comportamiento se prueba en su fase; F09 cierra integración técnica, cumplimiento, carga y recuperación. F10 cierra los hitos de distribución y aceptación de Google Play y confirma la preparación operativa de cada zona. Ningún hito exclusivo de F10 es requisito para cerrar F09.

La apertura requiere:

- CI completa aprobada: backend, PostgreSQL/Redis, contratos, TypeScript, lint y pruebas mobile.
- Tres entornos aislados: los tokens, webhooks y actualizaciones de pruebas no son aceptados por producción; la variante móvil muestra la identidad y consume la API correcta. Probar que reiniciar o limpiar recursos de desarrollo/pruebas no toca datos productivos.
- Promoción backend por la misma imagen certificada y revisión del AAB productivo antes de publicar. Confirmar rechazo de secretos cruzados, OTP simulado/fijo, autocompletado de prueba y pasarela simulada en producción; para correo/push de pruebas, comprobar la lista de destinatarios autorizados.
- Desarrollo/pruebas: recorrer alta por teléfono, OTP posterior a Google/Facebook y cambio de número con autocompletado, verificando cero llamadas al proveedor SMS tanto al enviar como al validar y reenviar. Desactivar autocompletado para comprobar códigos incorrectos, caducidad y uso único.
- Producción: certificar que ni parámetros, headers, flags ni un build de entorno bajo habiliten el simulador o devuelvan `test_code`. La entrega real de SMS se comprueba con el proveedor productivo de forma acotada y presupuestada; las pruebas simuladas no la sustituyen.
- Recorrido real en dos teléfonos para taxi, moto y encomienda, incluyendo efectivo y QR.
- Pruebas de alta e inicio por teléfono, OTP válido/incorrecto/vencido/reutilizado, reenvío, demora del SMS, abuso, cambio de número y recuperación sin pantallas bloqueadas.
- Google/Facebook con y sin teléfono verificado; vinculación explícita, teléfono ya registrado, altas concurrentes y migración de cuentas existentes sin perder historial ni elevar roles. Verificar que no se emitan sesiones operativas antes del OTP requerido.
- Pruebas de sesión inválida, cuenta suspendida y revocación; mientras exista acceso antiguo, incluir su manejo seguro de contraseñas largas.
- Pruebas de red lenta, reconexión, cierre de app, segundo plano, permisos denegados y GPS antiguo.
- Navegación Google en taxi/moto/encomienda hacia recogida y destino: voz, desvíos, llegada sin cierre automático, cambio de etapa y recuperación tras reinicio. Verificar Waze instalado/ausente, retorno a ViajaYa, seguimiento del pasajero y ausencia de cargos duplicados por render/reconexión.
- Pagos duplicados o tardíos, efectivo disputado, deuda de comisión, devolución y liquidación fallida.
- Aislamiento entre usuarios, conductores, zonas y permisos administrativos.
- Prueba sostenida con 500 conductores y una hipótesis inicial de 500 pasajeros conectados, más ráfagas de doble carga.
- Objetivos iniciales: API propia p95 ≤ 500 ms y evento realtime visible p95 ≤ 2 s, sin asignaciones duplicadas, cobros duplicados ni cancelaciones falsas.
- Restauración ensayada con objetivo RPO ≤ 15 minutos y RTO ≤ 2 horas; alerta real recibida y procedimiento de rollback comprobado.
- Instalación limpia, actualización, accesibilidad y binario firmado aceptado por Google Play.
- Conductores aprobados, soporte disponible y conciliación funcionando en cada zona habilitada.

Publicar primero mediante pruebas internas/cerradas y después abrir zonas gradualmente con las flags. Ampliar cobertura y capacidad según estabilidad, demanda y costo observado. La expansión a cada nuevo país será una entrega independiente con proveedores, moneda, documentación, soporte y condiciones locales certificados.
