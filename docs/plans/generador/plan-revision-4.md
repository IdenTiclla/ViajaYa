# Plan de salida a producción de ViajaYa

Fecha: 9 de septiembre de 2026. Estado: plan propuesto; el trabajo descrito está pendiente de implementación y certificación.

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

## 2. Trabajo pendiente, en orden de ejecución

**1. Preparar la operación y los proveedores**

- Registrar las zonas de apertura, servicios disponibles, horarios y responsables de soporte.
- Revisar con asesoría local las condiciones aplicables a transporte, moto, encomiendas, seguros, contratos de conductores, impuestos y facturación.
- Cotizar una pasarela boliviana que permita QR dinámico, consulta de pagos, notificaciones verificables, devoluciones y liquidaciones. Confirmar contractualmente que admite el modelo de cobro y comisión de ViajaYa.
- Definir en configuración comercial el porcentaje de comisión, calendario de liquidación, tratamiento de cancelaciones y límites de deuda por efectivo.
- Preparar cuentas empresariales de proveedores, dominio, correo y Google Play, con accesos recuperables y responsables identificados.
- Certificar la entrega real de OTP con operadores bolivianos mediante una comprobación productiva acotada antes de la apertura, con costo presupuestado; la simulación no certifica entrega SMS. Desarrollo y pruebas nunca llaman al proveedor OTP real. Habilitar países de destino de SMS productivos por configuración, según cobertura comercial, sin asumir entrega mundial.
- Cotizar Google Navigation SDK y validar sus condiciones para una app de movilidad, además de Maps/Places/Routes. Medir el consumo real antes de contratar un compromiso de volumen.

**Criterio de cierre:** cada zona tiene operación responsable y las integraciones de dinero tienen condiciones comerciales y entorno de pruebas confirmados.

**2. Acceso sencillo por teléfono, OTP y cuentas sociales**

- Reemplazar las pantallas separadas de login/registro por **Continuar con teléfono**, con selector de país y prefijo +591 inicial. Normalizar a E.164; admitir números extranjeros cuando el proveedor y la configuración lo permitan.
- Flujo principal: **teléfono → código OTP → cuenta existente o completar nombre y términos → inicio**. El código llega por SMS en producción y se simula/autocompleta en desarrollo y pruebas. No pedir correo ni contraseña para usar este acceso. Resolver la existencia de la cuenta después de verificar el código, con respuestas que no permitan enumerar teléfonos registrados.
- Mantener **Continuar con Google** y **Continuar con Facebook**. El backend verifica la identidad del proveedor y, en el primer acceso sin teléfono verificado, solicita **número → OTP → completar datos/términos**. La identidad social por sí sola no permite pedir viajes ni conducir.
- Una sesión válida se conserva al reabrir la app. No enviar un SMS en cada apertura ni en cada viaje. Volver a verificar al cambiar el número, recuperar acceso o cuando una comprobación de seguridad lo exija.
- Modelar una cuenta interna estable y varias identidades vinculadas. El teléfono verificado debe ser único entre cuentas activas. Vincular Google/Facebook solo con confirmación explícita y prueba de ambas identidades; no fusionar por coincidencia de correo ni por un teléfono histórico sin verificar.
- Guardar desafíos OTP con caducidad, uso único, número, finalidad e identificador de proveedor. Limitar intentos, reenvíos y solicitudes por número, IP y dispositivo; contemplar códigos incorrectos, vencidos, SMS retrasados y errores del proveedor. No guardar códigos ni tokens en logs.
- Emitir credenciales operativas solo tras la verificación requerida; el alta debe ser idempotente para evitar duplicados ante reintentos o solicitudes simultáneas. Incorporar sesiones por dispositivo, rotación de refresh, detección de reutilización y revocación HTTP/WS.
- Permitir editar y verificar un nuevo número mediante reautenticación; revocar sesiones cuando corresponda. Si se pierde el número, ofrecer recuperación asistida y auditada, considerando números reciclados o cuentas en conflicto.
- Migrar usuarios actuales conservando ID, historial, rol y ganancias. Exigir prueba de acceso a la cuenta anterior y OTP antes de vincular el teléfono. No elevar roles durante el alta; los conductores mantienen la aprobación del frente 5.
- Retirar correo/contraseña del flujo móvil nuevo. Mientras exista un acceso antiguo para migración, corregir su truncamiento a 72 bytes y no aceptar credenciales ambiguas sin recuperación. Al cerrar la transición, deshabilitar esos endpoints; no construir un nuevo flujo de contraseñas para usuarios nuevos.
- Mantener la autenticación reforzada del panel administrativo; el acceso sencillo de pasajeros y conductores no elimina ese requisito. Conservar límites contra abuso en ofertas, solicitudes y WS, y tiempos de espera en verificaciones externas.

**Criterio de cierre:** un usuario puede registrarse o entrar con su teléfono sin contraseña, o con Google/Facebook más teléfono verificado, sin crear cuentas duplicadas. Los errores de OTP y sesión ofrecen reintento, cambio de número o recuperación; las cuentas suspendidas o revocadas no obtienen acceso operativo.

**OTP sin costo de proveedor en ambientes bajos**

- En **desarrollo y pruebas**, usar siempre un adaptador OTP simulado dentro del backend, sin llamadas de envío ni de verificación a Twilio u otro proveedor externo. Estos despliegues no reciben credenciales del proveedor SMS; no existe fallback a envíos reales si falla el simulador.
- Generar un código de prueba por desafío y conservar las mismas comprobaciones de finalidad, teléfono, caducidad, intentos y uso único del flujo normal. Evitar un código universal que permita saltarse la verificación.
- Solo el backend de un entorno bajo puede devolver el campo `codigo_prueba` en la respuesta del desafío. La variante móvil de ese entorno rellena automáticamente el formulario y muestra **OTP de prueba · sin SMS**. El usuario pulsa Continuar y el backend verifica el desafío; autocompletar no equivale a iniciar sesión automáticamente.
- Permitir desactivar el autocompletado en desarrollo/pruebas para ingresar códigos erróneos y ensayar caducidad, reenvíos, límites y fallos simulados del proveedor. Los reintentos siguen siendo locales y gratuitos respecto al proveedor OTP.
- Aplicar esta simulación al acceso por teléfono, al paso OTP posterior a Google/Facebook y a las verificaciones de cambio de número/recuperación. Toda cuenta y verificación obtenida así permanece en su entorno aislado.
- Seleccionar el modo por configuración de despliegue validada al iniciar, no por parámetros enviados por la app ni por una flag comercial que pueda activarse en producción. El servidor productivo rechaza la configuración simulada, no devuelve `codigo_prueba` y no acepta desafíos ni tokens de entornos bajos. El build productivo excluye la ayuda de autocompletado de prueba.
- El autocompletado que el sistema operativo pueda ofrecer a partir de un SMS real en producción es independiente: ese SMS sí puede generar cargos. Aquí el ahorro se obtiene porque en ambientes bajos no se envía ni verifica nada con un proveedor externo.

**Aceptación:** se completa el flujo OTP de desarrollo/pruebas con el campo autocompletado y **cero llamadas al proveedor externo**; producción conserva verificación real y no expone códigos de prueba. El costo de cómputo/hosting del simulador permanece dentro del presupuesto del entorno.

**3. Construir el panel administrativo y las feature flags**

Crear un panel web interno para:

- Revisar conductores, documentos y vehículos.
- Consultar viajes, incidentes, cobros, liquidaciones y comisiones pendientes.
- Resolver operaciones excepcionales mediante acciones auditadas.
- Administrar países, zonas, servicios y disponibilidad.
- Consultar indicadores de operación y gasto.

Implementar permisos separados para administración, soporte y finanzas, autenticación reforzada y registro de quién cambió qué.

Las flags se evaluarán en el backend y permitirán habilitar servicios, métodos de pago y funciones por país, ciudad y grupo de usuarios. La app recibirá la configuración para presentar las opciones disponibles.

Incluir flags para Google/Facebook, países autorizados para SMS, navegación Google integrada y alternativa Waze. Si falla el servicio OTP, pausar altas/accesos que requieran verificación y ofrecer reintento; nunca omitir la comprobación como fallback. Los cambios de navegación tampoco deben cortar una guía ni un viaje ya iniciados.

**Apagar una función bloqueará operaciones nuevas y permitirá terminar los viajes y pagos existentes.** Los parámetros internos de Redis, outbox y scheduler conservarán su procedimiento técnico de despliegue.

**4. Preparar la expansión territorial**

- Sustituir las reglas fijas de Bolivia por un catálogo de países y zonas.
- Asociar viajes, ofertas, pagos y liquidaciones con su zona y moneda.
- Mantener importes decimales; impedir sumar o liquidar monedas diferentes.
- Guardar fechas en UTC y calcular jornadas operativas según la zona horaria correspondiente.
- Normalizar teléfonos internacionales, permitiendo que un visitante extranjero use ViajaYa en Bolivia.
- Separar proveedores de pagos, mensajería y requisitos documentales por mercado.

**Criterio de cierre:** añadir un país tiene puntos de configuración y extensión claros. Su activación exige igualmente certificación comercial, legal y operativa.

**5. Completar conductores, cobertura y seguridad del servicio**

- Incorporar solicitud de alta, carga privada de documentos, revisión, aprobación, rechazo, suspensión y vencimientos.
- Permitir recibir solicitudes únicamente a conductores aprobados, disponibles y habilitados para ese servicio y zona.
- Filtrar solicitudes por cercanía y cobertura; limitar los datos personales y ubicaciones exactas expuestos antes de la asignación.
- Implementar motivos de cancelación, pasajero ausente, incidentes y resolución de viajes atascados.
- Ofrecer soporte desde el viaje y el historial, con un procedimiento humano de atención.
- Incorporar identificación del vehículo y verificación de recogida para reducir errores de pasajero o encomienda.

**6. Implementar navegación integrada, seguimiento GPS y notificaciones**

- Enviar ubicación del conductor con hora y precisión; mostrar su posición real al pasajero autorizado.
- Detectar posiciones antiguas y comunicar pérdida de señal.
- Mantener seguimiento durante el servicio con los permisos y mecanismos Android apropiados; detenerlo al finalizar o quedar fuera de servicio.
- Añadir push para aceptación, llegada, cancelación y novedades relevantes. Al abrir una notificación, consultar el estado actual.
- Conservar la caducidad de ofertas de **30 segundos** y la gracia de presencia del pasajero de **120 segundos**.
- Llevar las consultas HTTP propias de Places, Routes y geocodificación al backend autenticado, con límites, cancelación y tiempos de espera. El Navigation SDK nativo se integra en Android y usa sus mecanismos de conexión y credenciales restringidas; no se convierte en una consulta HTTP del backend.
- Separar credenciales nativas y de servidor, restringiéndolas por aplicación, firma y API según corresponda; controlar campos solicitados y recálculos.
- Mostrar errores de rutas explícitamente.

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

**Criterio de cierre:** el conductor puede ir a recoger y completar el trayecto con guía dentro de ViajaYa; el pasajero conserva el seguimiento, y los fallos o cambios de app no pierden el viaje.

La ubicación con la app minimizada debe justificarse y declararse conforme a los [requisitos de Google Play](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en).

**7. Construir pagos, comisiones y liquidaciones**

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

**Criterio de cierre:** cada importe puede explicarse desde el viaje hasta su cobro, comisión y liquidación, incluso tras una caída del servidor.

**8. Completar encomiendas**

- Añadir remitente, destinatario, teléfonos, descripción y límites del paquete.
- Informar artículos restringidos y condiciones del servicio.
- Registrar retiro, entrega y comprobación de recepción mediante código.
- Resolver destinatario ausente, entrega fallida, devolución e incidentes.
- Asociar cualquier ajuste de cobro con una causa y aprobación auditables.

**Criterio de cierre:** una entrega puede completarse o resolverse excepcionalmente sin editar la base de datos.

**9. Preparar infraestructura, despliegues y observabilidad**

Arquitectura inicial propuesta: **Render de pago**, con API permanente, PostgreSQL administrado con réplica de disponibilidad, Redis/Valkey privado y panel estático. Validar la latencia desde redes móviles bolivianas antes de fijar región; Render actualmente no ofrece región sudamericana. [Regiones disponibles](https://render.com/docs/regions).

- Separar desarrollo, pruebas y producción conforme al aislamiento y flujo de promoción definidos a continuación.
- Crear imágenes reproducibles y despliegue automatizado con HTTPS/WSS.
- Ejecutar migraciones mediante un único proceso y comprobar compatibilidad antes de actualizar.
- Validar configuración productiva: secretos, conexiones y URLs; rechazar valores locales o inseguros.
- Completar la promoción gradual del sistema realtime existente y certificar dos réplicas.
- Centralizar errores de backend y Android, registros sanitizados, métricas y alertas con destinatario real.
- Proteger métricas y herramientas administrativas.
- Configurar backups, recuperación a un momento determinado y copia externa; ensayar restauración y rollback.
- Fijar versiones de dependencias, escaneo de secretos y controles obligatorios para integrar cambios.

**Tres entornos, tres propósitos**

| Entorno | Propósito y despliegue | Datos e integraciones | App Android |
|---|---|---|---|
| Desarrollo | Trabajo diario en la computadora del desarrollador, API y servicios locales; validar cambios antes de PR | Datos ficticios reiniciables, pagos simulados y OTP simulado con autocompletado, siempre sin proveedor externo | Perfil EAS `development`; nombre ViajaYa Desarrollo e identificador `com.viajaya.app.dev` |
| Pruebas | Entorno alojado y privado para QA, integración entre teléfonos y certificación del candidato; versiones y arquitectura equivalentes a producción con recursos ajustados | Base y caché propias; datos sintéticos, pasarela sandbox y OTP simulado con autocompletado sin SMS ni cargos de proveedor; ensayos de mapas limitados cuando sean necesarios | Perfil EAS `preview`; nombre ViajaYa Pruebas e identificador `com.viajaya.app.pruebas` |
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

**Promoción de versiones: desarrollo → pruebas → producción**

- Desarrollo: implementar en una rama y enviar PR. CI ejecuta contratos y pruebas sobre bases temporales desechables; estas bases son recursos de test, no un cuarto entorno permanente.
- Pruebas: desplegar el candidato identificado por commit y versión, aplicar migraciones y ejecutar QA funcional, OTP simulado con autocompletado, OAuth, pagos sandbox, navegación, realtime y comprobaciones de aislamiento. Ensayar cambios de esquema, restauración y rollback antes de promoverlos.
- Producción: promover la misma imagen backend certificada, con configuración y secretos de producción. Ejecutar migraciones compatibles mediante un único proceso y comprobar salud; conservar la imagen anterior para rollback. No ejecutar suites destructivas o seeds de pruebas sobre datos reales.
- Android: generar las variantes de entorno desde el mismo commit. Como sus identificadores y credenciales son diferentes, certificar también el AAB productivo firmado en la pista interna/cerrada de Google Play antes de promover ese mismo AAB al público. Una pista de distribución no cambia automáticamente la API a la que apunta el binario.
- Registrar versión, entorno, resultado de pruebas y responsable de promoción. El despliegue público queda bloqueado si fallan las comprobaciones, existen secretos cruzados o quedan simulaciones activadas. Los cambios nativos requieren un binario compatible; las actualizaciones móviles no deben cruzar entornos.

**Criterio de cierre del frente 9:** los tres entornos están identificados y aislados; probar o reiniciar desarrollo/pruebas no altera producción. Un candidato puede recorrer el flujo completo de validación, promoción y rollback con evidencia.

**10. Privacidad y publicación Android**

- Publicar términos, privacidad, soporte y condiciones de conductores.
- Guardar aceptación versionada de términos.
- Implementar solicitud de eliminación, anonimización y reglas de conservación por categoría.
- Proporcionar eliminación desde la app y una vía web accesible: Google Play exige ambas para aplicaciones que crean cuentas. [Política de eliminación](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN).
- Completar Data Safety, declaraciones de permisos, ficha, capturas y acceso para revisión.
- Generar y probar el AAB firmado sin depender de Metro.
- Certificar Google/Facebook con las firmas y credenciales de producción.
- Comprobar si aplica la prueba cerrada de 12 participantes durante 14 días, exigida a determinadas cuentas personales nuevas. [Requisitos de pruebas](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB).

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

La respuesta OTP de desarrollo/pruebas puede incluir `codigo_prueba` para el autocompletado. El contrato productivo no incluye ese campo; CI debe certificar su ausencia y el rechazo de cualquier solicitud que intente activar el modo simulado desde el cliente.

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

Ejecutar los bloques anteriores mediante PR separados, con sus pruebas y criterios de cierre. Preparar proveedores y configuración comercial en paralelo con seguridad y panel; integrar pagos y encomiendas antes de certificar el lanzamiento completo.

La apertura requiere:

- CI completa aprobada: backend, PostgreSQL/Redis, contratos, TypeScript, lint y pruebas mobile.
- Tres entornos aislados: los tokens, webhooks y actualizaciones de pruebas no son aceptados por producción; la variante móvil muestra la identidad y consume la API correcta. Probar que reiniciar o limpiar recursos de desarrollo/pruebas no toca datos productivos.
- Promoción backend por la misma imagen certificada y revisión del AAB productivo antes de publicar. Confirmar rechazo de secretos cruzados, OTP simulado/fijo, autocompletado de prueba y pasarela simulada en producción; para correo/push de pruebas, comprobar la lista de destinatarios autorizados.
- Desarrollo/pruebas: recorrer alta por teléfono, OTP posterior a Google/Facebook y cambio de número con autocompletado, verificando cero llamadas al proveedor SMS tanto al enviar como al validar y reenviar. Desactivar autocompletado para comprobar códigos incorrectos, caducidad y uso único.
- Producción: certificar que ni parámetros, headers, flags ni un build de entorno bajo habiliten el simulador o devuelvan `codigo_prueba`. La entrega real de SMS se comprueba con el proveedor productivo de forma acotada y presupuestada; las pruebas simuladas no la sustituyen.
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
