# Plan de salida a producción de ViajaYa

Fecha inicial: 9 de septiembre de 2026. **Actualización: 19 de septiembre de 2026 · Revisión 23.** Base revisada: `main`, commit `986dd79` (integración del PR #15, 14/09/2026).

**Política vigente (19/09/2026):** usamos únicamente **Desarrollo**. **Pruebas (`testing`/`preview`/staging) queda temporalmente deprecado**: no iniciar, desplegar ni generar entregas para ese entorno. Producción sigue siendo un objetivo futuro. Las configuraciones anteriores se conservan como referencia; las pruebas automatizadas y las bases desechables de CI continúan vigentes.

**Situación:** el núcleo del viaje y del acceso está implementado; todavía no hay evidencia suficiente para abrir al público. F01 está completada localmente, F02 sigue en curso y F04 tiene una entrega parcial adelantada. F03 está planificada sin implementar. F05 y F06 incorporan una entrega local de seguimiento GPS, navegación integrada Android y Waze; conservan pendientes las pruebas en teléfonos. F07–F10 siguen pendientes.

El estado se apoya en código, historial y [evidencia de esta revisión](production-readiness-2026-09-19.md). La instalación de APK, Google en Desarrollo y HTTPS de Pruebas corresponden a verificaciones históricas del 9–13/09; esta revisión no comprueba que esos servicios sigan encendidos ni que los teléfonos tengan el código actual. El último APK de Pruebas documentado precede a las últimas correcciones y al acceso social.

**Entrega local posterior a la base:** la rama `codex/ui-improvements-and-bugfixes` incorpora mejoras de acceso/registro y del recorrido de taxi y mototaxi, registradas en `e10e6ae`. La revisión 14 corrige el error al cerrar la calificación del conductor, reemplaza ETA manual por cálculo GPS → recogida, selecciona la alternativa más rápida con tráfico y estabiliza/bloquea el mapa al cambiar de servicio. Conserva la coordinación llegada → «ya salí» → inicio → cierre. La revisión 15 permite enviar varias ofertas sin bloquear el resto del pool, conserva los envíos al navegar y abre el viaje asignado aunque se estuviera viendo otra negociación. La revisión 16 corrige mejoras ocultas por eventos antiguos, respuestas de otros viajes, recuperación de páginas y ofertas sobre una recogida modificada; ver [auditoría 0016](../implementation-plans/0016-negotiation-race-audit.md). La revisión 17 añade 31 casos automatizados y corrige la comprobación de confirmaciones atrasadas; ver [cobertura y evidencia 0017](../implementation-plans/0017-trip-test-coverage.md). Ver [negociaciones simultáneas y evidencia](../implementation-plans/0015-concurrent-negotiations.md). Evidencia y límites anteriores: [ETA automática y mapa estable](../implementation-plans/0014-automatic-arrival-and-stable-route.md) y [experiencia de recogida](../implementation-plans/0013-passenger-driver-pickup-experience.md).

**Experiencia del viaje (revisión 18):** mapa con espacio estable durante negociación y seguimiento, comparación de ofertas por precio/llegada, recogida y contacto más visibles para el conductor, cancelación secundaria y calificación breve con comentario opcional desplegable. Ver [experiencia y validación 0018](../implementation-plans/0018-trip-experience.md).

**Componentes compartidos (revisión 19):** botones con jerarquía consistente, campos con ayuda y contador, confirmaciones adaptadas al móvil, estados de carga/error y avatares reutilizables. Aplicados a ofertas, seguimiento, perfil y calificación; ver [entrega y validación 0019](../implementation-plans/0019-shared-components.md).

**Mapas (revisión 20):** edificios planos, espera del conductor bloqueada y radar ligado a su posición proyectada; configuración sin bloques A/B superiores y rutas más cercanas con márgenes compactos y paneles medidos. Ver [entrega y validación 0020](../implementation-plans/0020-map-framing-and-radar.md).

**Llegada y espacio del mapa (revisión 21):** corregida la oferta con recogida cercana, que descartaba una respuesta válida de Google y mostraba un falso error de conexión. Configuración usa controles sobre el mapa; búsqueda mide su espacio y acerca la ruta. Todos los mapas desactivan interiores e inclinación y ocultan geometrías de edificios/relieve, también en tema claro. Ver [evidencia y límite de verificación nativa 0021](../implementation-plans/0021-nearby-arrival-and-clear-maps.md).

**Seguimiento y navegación (revisión 22):** el trabajo anterior quedó en `e10e6ae`. Se incorpora GPS privado por viaje con snapshot/reconexión, señal antigua y corte al cierre; servicio Android para compartir al usar Waze; Google Navigation hacia recogida y destino, sin avanzar automáticamente el viaje. Avance registrado en un commit independiente en la misma rama; no se hizo push. Ver [implementación, evidencia y pendientes 0022](../implementation-plans/0022-driver-navigation-and-live-tracking.md).

### Qué tenemos y qué impide lanzar

| Área | Avance comprobable | Pendiente para operar |
|---|---|---|
| Viajes | Negociaciones simultáneas, asignación atómica, llegada, aviso «ya salí», inicio, cierre, historial y calificaciones | Incidentes, recogida verificada y soporte operativo |
| Acceso | Teléfono/OTP simulado, sesiones revocables, vinculación social; Google probado en Desarrollo | SMS real, APK/recorrido actualizado de Pruebas y recuperación accesible al usuario y al operador |
| Conductores | Registro desde Perfil, hasta un vehículo por tipo, servicios y cambio de modo/vehículo | Documentos privados, revisión administrativa, suspensión, vencimientos y elegibilidad por zona |
| Tiempo real y mapas | WebSockets, outbox, Redis, scheduler, mapas y rutas | Rollout operativo, GPS del conductor hacia el pasajero, segundo plano, push y Navigation SDK |
| Dinero y encomiendas | Selección QR/efectivo y tipo de servicio `delivery` | Cobro verificable, comisiones, liquidaciones, destinatario, paquete y comprobación de entrega |
| Despliegue | Configuración de tres entornos, Docker, CI y variantes Android | Alojamiento certificado, restauración, carga objetivo, privacidad y Google Play |

**No se calcula un porcentaje global:** las diez fases tienen tamaños distintos y varias contienen avances parciales. Una fase cerrada localmente no equivale al 10 % del producto ni certifica producción.

La [presentación HTML](presentacion-salida-produccion.html) está sincronizada con esta revisión 23: resume las diez fases, la evidencia y las próximas entregas. Su vista «Plan completo» y su descarga contienen este documento íntegro.

## 1. Objetivo y decisiones de partida

Lanzar públicamente en **Android, en Bolivia, con taxi, moto y encomiendas**, preparado para incorporar otros países. Incluir pagos **QR al finalizar y efectivo**, comisión por servicio y un **panel administrativo con feature flags**.

La capacidad objetivo será **500 conductores conectados y 5.000 servicios diarios**. Es una meta que debemos comprobar con pruebas; no exige contratar toda esa capacidad desde el primer día.

El proyecto ya tiene negociación, asignación atómica, ciclo del viaje, historial, calificaciones, WebSockets, outbox, Redis y una base de pruebas automatizadas. Los principales pendientes están en seguridad de cuentas, operación comercial, seguimiento GPS, pagos, encomiendas y despliegue.

Decisiones iniciales:

- Activar cobertura por ciudades y zonas desde el panel. Publicar en Bolivia no habilitará automáticamente todo el territorio.
- Mantener el monolito FastAPI y la app actual.
- Operar únicamente **Desarrollo** mientras rija esta decisión. **Pruebas está temporalmente deprecado**; no es una dependencia para validar el trabajo actual. Producción se habilitará en una entrega futura aprobada.
- Unificar inicio de sesión y registro en **Continuar con teléfono**, sin contraseña para el flujo nuevo: **OTP por SMS real en producción** y **OTP simulado con autocompletado en desarrollo**. Google y Facebook serán alternativas opcionales, también sujetas al flujo de verificación del teléfono correspondiente al entorno.
- Ofrecer **navegación giro a giro dentro de ViajaYa con Google Navigation SDK**, hacia la recogida y luego al destino. Waze será una opción externa voluntaria; no sustituye el requisito de navegación integrada.
- Incorporar país, moneda, zona horaria y proveedores configurables. Bolivia comienza con `BO`, `BOB` y `America/La_Paz`.
- Dejar iOS, viajes internacionales y conversión de monedas para fases posteriores.
- Mantener el alcance de apertura acordado: taxi, moto y encomiendas. El código ya incluye camioneta/`moving` (mudanzas); su inclusión comercial requiere una decisión explícita y criterios propios antes de habilitarlo al público.
- Usar las siguientes cifras como orientación presupuestaria; contratar servicios será un hito posterior.

**Historial resumido:** las revisiones 2–4 fijaron teléfono/OTP, navegación integrada y tres entornos con OTP simulado en Desarrollo. Las revisiones 5–9 organizaron las diez fases y registraron F01, F02-A/B, APK y la recuperación de HTTPS. El 13/09 se verificó Google en Desarrollo y se retiró el acceso por contraseña. El 14/09 esos cambios y el alta de conductores con varios vehículos quedaron integrados en `main`. Los detalles históricos permanecen en los [planes de implementación](../implementation-plans/0010-phone-identity-and-otp.md). La revisión 10 corrigió estados, dependencias prácticas y siguientes entregas. La revisión 11 añade la evidencia local de UI y del recorrido de taxi/mototaxi en la rama de trabajo; no cierra la certificación productiva. La revisión 12 verifica la corrección de H01–H05, ETA manual y perfiles de ruta por servicio. La revisión 13 añade coordinación persistente de recogida, confirmación de oferta y protección ante reconexiones atrasadas; verifica ambos roles y accesibilidad visual. La revisión 14 incorpora la devolución de las pruebas del usuario: cierre sin error de cancelación interna, ETA automática, rutas con tráfico y mapa estable. La revisión 15 verifica varias negociaciones por conductor y pasajero, envíos independientes y asignación única aun con aceptaciones simultáneas. La revisión 16 corrige cuatro bugs reproducidos de concurrencia, paginación y versión de solicitud.

## 2. Hoja de ruta por fases

Cada fase produce una entrega revisable. Los PR sugeridos ordenan unidades de implementación; no todos representan PR creados. F01, F02 y el adelanto de conductores están integrados en el historial del PR #15. Una fase solo se cierra con su criterio y evidencia, aunque parte del código ya exista. Las dependencias siguientes son de **cierre**: permiten adelantar trabajo independiente sin dar por terminada la fase anterior.

| Fase | Entrega | Dependencias para cerrar | Estado |
|---|---|---|---|
| F01 | Base técnica y política de entornos | Ninguna; punto de inicio. | Completada localmente |
| F02 | Teléfono, OTP y cuentas sociales | F01. | En curso: código A/B/C integrado; SMS, Pruebas y recuperación por completar; Facebook aplazado |
| F03 | Países, panel base y feature flags | F01–F02. | Pendiente: F03-A planificada; B/C pospuestas, necesarias antes de apertura |
| F04 | Conductores y operación del viaje | F02–F03. | En curso parcial: alta, varios vehículos y modos implementados; operación pendiente |
| F05 | Seguimiento, mapas y notificaciones | F04. | Parcial: GPS privado y recuperación implementados; faltan prueba en teléfonos, push y cierre de mapas |
| F06 | Navegación del conductor | F05; la prueba de compatibilidad nativa puede adelantarse a F01. | Parcial: Google Navigation Android y Waze implementados; certificación de recorrido pendiente |
| F07 | Cobros, comisiones y liquidaciones | F03–F04; puede avanzar en paralelo con F05–F06. Sandbox y contrato del proveedor para cerrar la integración. | Pendiente |
| F08 | Encomiendas completas | F04–F07 para cerrar el recorrido completo; formularios y estados pueden adelantarse. | Pendiente |
| F09 | Certificación productiva y cumplimiento | F01–F08 y disponibilidad de presupuesto/proveedores. Realizar los ensayos actuales en Desarrollo; acordar la infraestructura futura antes de la apertura. | Pendiente |
| F10 | Google Play y apertura gradual | F09. La cuenta Play y preparación de la ficha pueden adelantarse. | Pendiente |

**Secuencia principal:** F01 → F02 → F03 → F04 → F05 → F06 → F08 → F09 → F10. F07 parte de F03–F04, puede avanzar junto a F05–F06 y también debe terminar antes de F08. Con una sola persona, usar el orden numérico F01–F10.

**Trabajo anticipable:** preparar cuentas, requisitos de Play y cotizaciones desde F01; adelantar F06-A para comprobar compatibilidad nativa; realizar QA y recorridos entre teléfonos en Desarrollo; Pruebas no se aprovisiona mientras esté deprecado. La infraestructura alojada se certifica en F09. Estas tareas conservan el número de su fase y no alteran sus dependencias de cierre.

### Próximas entregas desde esta revisión

| Orden | Trabajo concreto | Evidencia para darlo por terminado | Dependencia / responsable necesario |
|---|---|---|---|
| 1 | Completar la entrada visible a recuperación, actualizar el candidato de Pruebas desde un commit identificado y certificar el acceso en Android | API/migraciones y APK coinciden; teléfono, Google, sesión, cambio de número, solicitud de recuperación y recorrido pasajero/conductor probados en teléfonos; CI remota enlazada | Desarrollo + persona que haga QA; credenciales de Pruebas; aprobación de recuperación en F03-B |
| 2 | Implementar F03-A según el plan 0011 | Zona y moneda en backend/mobile, importes compatibles y backfill probado en PostgreSQL desechable | Desarrollo; puede avanzar mientras se decide el proveedor SMS |
| 3 | Completar F03-B/C y la parte administrativa de F04-A | Operador revisa vehículos/documentos y recuperación con permisos/auditoría; flags controlan nuevas operaciones | Desarrollo + definición de responsables de soporte |
| 4 | Completar F04-B/C y F05; adelantar F06-A | Viaje en dos teléfonos, ubicación autorizada y recuperación; prueba nativa de navegación resuelta | QA Android y presupuesto acotado de mapas |
| 5 | F06, F07 y F08 | Guía integrada y servicio completo con efectivo/QR, comisión y entrega de encomienda | Proveedor QR, reglas comerciales y operación |
| 6 | F09 y F10 | Candidato alojado y certificado, restauración/carga, privacidad y AAB aceptado; apertura por zonas | Presupuesto, proveedores, responsables y cuenta Play |

**Frente paralelo que no puede quedar para el final:** elegir el proveedor SMS e implementar su adaptador en F02-C; cotizar QR para F07; confirmar tipo de cuenta Play, ciudad/zona inicial, presupuesto mensual y equipo de soporte. Facebook sigue aplazado y deshabilitado; no bloquea tareas independientes. Antes de certificar F09 se registra si entra en esta salida o si se mantiene deshabilitado como alternativa opcional.

**Fecha de apertura:** por definir después de cerrar alcance, equipo y proveedores. No se promete una fecha basada solo en cantidad de fases. El siguiente hito medible es un candidato actualizado de Pruebas con el recorrido de acceso y viaje documentado; eso todavía no es una apertura comercial.

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

### Fase 01. Base técnica y política de entornos

**Estado:** Completada y verificada localmente; integrada en `main` mediante el PR #15. **Evidencia:** [plan 0009](../implementation-plans/0009-environment-foundation.md). La definición de CI existe; el resultado remoto del candidato no se comprobó en esta revisión. Alojamiento y certificación del despliegue permanecen en F09.

**Objetivo:** Mantener Desarrollo reproducible y conservar el aislamiento de las configuraciones futuras. Pruebas queda inactivo hasta una nueva decisión.

**Dependencias:** Ninguna; punto de inicio.

**Entregas en orden:**

- [x] F01-A · Configuración validada de los tres entornos y ejemplos sin secretos.
- [x] F01-B · Variantes Android, identidades y destinos de API separados.
- [x] F01-C · Imágenes reproducibles, CI y contratos de proveedores simulados.

**Alcance y decisiones técnicas**

**Estado operativo de las configuraciones**

| Entorno | Propósito y despliegue | Datos e integraciones | App Android |
|---|---|---|---|
| Desarrollo | Trabajo diario en la computadora del desarrollador, API y servicios locales; validar cambios antes de PR | Datos ficticios reiniciables, pagos simulados y OTP simulado con autocompletado, siempre sin proveedor externo | Perfil EAS `development`; nombre ViajaYa Desarrollo e identificador `com.viajaya.app.dev` |
| Pruebas — deprecado temporalmente | Inactivo para el trabajo actual; definición conservada como referencia | Base y caché propias; datos sintéticos, pasarela sandbox y OTP simulado con autocompletado sin SMS ni cargos de proveedor; ensayos de mapas limitados cuando sean necesarios | Perfil EAS `preview`; nombre ViajaYa Pruebas e identificador `com.viajaya.app.testing` |
| Producción — futuro | Servicio público para pasajeros, conductores y operación real; únicamente versiones certificadas | Datos reales, pasarela de cobro real, credenciales productivas, backups y monitoreo permanente | Perfil EAS `production`; nombre ViajaYa e identificador `com.viajaya.app` |

Los perfiles y sus validaciones se conservan por compatibilidad. Solo se usa `development`: QA funcional, integración entre teléfonos y APK de esta entrega apuntan a Desarrollo. Los APK y recursos de Pruebas citados en evidencias anteriores son históricos; no representan un entorno operativo vigente.

**Aislamiento conservado para la futura apertura**

- Cada entorno tiene su propia API, PostgreSQL, Redis/Valkey, almacenamiento de documentos, cuentas operativas, flags y secretos. No compartir recursos de datos entre pruebas y producción. La API y el panel de pruebas se restringen al equipo y testers.
- Asignar URLs distintas a API, WebSocket, panel y webhooks; el dominio concreto se configura al contratarlo. El servidor valida su entorno al iniciar y rechaza combinaciones cruzadas o valores locales en producción.
- Separar claves de firma y validación de sesiones, identidades de emisor/audiencia, cuentas de servicio y permisos. Un token de desarrollo o pruebas debe ser rechazado por producción, aunque los números de teléfono sean iguales.
- Separar proyectos/credenciales de Google Maps y Navigation, clientes OAuth, aplicaciones o configuración de prueba de Facebook, claves de pasarela y secretos de webhooks. Configurar firmas Android, redirecciones y cuotas para el identificador correspondiente.
- Aislar OTP, correo y push por entorno. OTP es exclusivamente simulado y autocompletado en desarrollo, sin credenciales ni llamadas al proveedor real. Para correo y push, mantener simulaciones/sandbox o destinatarios de prueba autorizados según la integración. Los códigos fijos, autocompletado de prueba, pagos simulados y modos de test deben provocar rechazo de configuración si se intentan activar en producción.
- Mantener destinos de actualización móvil y configuración de runtime separados, ligados a su build y entorno. La app productiva no ofrece un selector de servidor; desarrollo y pruebas tienen nombre distintivo y un indicador de entorno para evitar confusiones, y pueden instalarse junto a producción.
- Promover reglas y versiones de flags de manera explícita; activarlas en pruebas no debe activarlas en producción. Identificar el entorno en registros, errores, alertas, copias de seguridad y métricas de gasto, con accesos y retención propios.
- Usar datos sintéticos; si se necesita reproducir un caso real, anonimizarlo mediante un procedimiento revisado. No copiar datos personales, documentos, tokens ni secretos productivos a desarrollo o pruebas.

**Preparación técnica inicial**

- Crear imágenes y dependencias reproducibles, controles de CI y contratos de configuración de los proveedores. Preparar el modo OTP simulado exclusivamente para desarrollo; su flujo y autofill se implementan en F02.
- Declarar infraestructura, URLs, secretos requeridos y promoción sin contratar ni aprovisionar automáticamente servicios de pago. No crear un cuarto entorno.
- Registrar la prueba anticipada de compatibilidad Google Navigation/Expo 56 como tarea F06-A si conviene despejar ese riesgo temprano.

El aislamiento se construye desde F01 y se mantiene en cada fase. La promoción completa se ejecuta y certifica en F09; no se posterga hasta entonces la separación de datos o credenciales.

**Comprobación y evidencia:** Arranque documentado en Windows, validación de configuraciones válidas/inválidas, tokens cruzados rechazados y builds identificables. Ningún secreto se incorpora al repositorio.

**Criterio de cierre de F01:** Desarrollo funciona de forma reproducible; CI comprueba aislamiento y rechazo de configuraciones inseguras. Las definiciones históricas de los otros entornos se conservan; Pruebas no se opera ni es requisito del trabajo actual. La infraestructura productiva futura se certificará en F09.

**Costo o dependencia externa:** Puede comenzar localmente sin contratar nube ni SMS. Actualmente solo se opera Desarrollo; no se presupuesta ni aprovisiona Pruebas.

**Verificación registrada (09/09/2026):** 649 pruebas backend aprobadas; 69 pruebas opt-in PostgreSQL/Redis omitidas. 235 pruebas mobile, Ruff, TypeScript, lint y contratos aprobados. Tres proyectos Android generados, bundle Hermes compilado, imagen Docker construida y smoke contra PostgreSQL desechable aprobado. Configuración Compose y workflow validados.

**Límites de la entrega:** a la generación nativa inicial se añadió la verificación histórica de APK de Desarrollo del 09/09; no certifica el AAB productivo ni un viaje completo con la versión actual. El OTP móvil ya se implementó en F02. No consta alojamiento permanente certificado. El acceso vigente exige sesiones administradas; los tokens legacy se retiraron en F02.

### Fase 02. Teléfono, OTP y cuentas sociales

**Estado:** En curso; código de A/B/C integrado en `main`. Google verificado en Desarrollo el 13/09; existe evidencia histórica de HTTPS y APK F02-B en Pruebas. Falta actualizar/certificar ese candidato, conectar SMS real y completar la experiencia de recuperación. **PR:** #15, integrado. **Responsable del siguiente cierre:** por asignar. **Evidencia:** [plan 0010](../implementation-plans/0010-phone-identity-and-otp.md).

**Objetivo:** Permitir entrar o registrarse con teléfono y OTP, con Google/Facebook opcionales y recuperación sin bloqueos.

**Dependencias:** F01.

**Entregas en orden:**

- [x] F02-A · Identidad estable, desafío OTP y formulario con autofill simulado, verificados en aislamiento. Activación en el acceso unificado: F02-B.
- [x] F02-B · Código del flujo móvil unificado, sesiones, cambio de número y recuperación de acceso.
- [x] F02-B · Activar ambas API y verificar OTP, cuentas y sesiones contra los servicios locales.
- [x] F02-B · HTTPS público mediante ngrok y APK inicial de Pruebas verificados históricamente.
- [ ] F02-B · Actualizar API/migraciones y APK de Pruebas desde el mismo candidato; recorrer acceso, sesión, cambio de número y viaje en teléfono.
- [ ] F02-B · Restituir una entrada visible a recuperación de acceso y probarla. El controlador/caso de uso existe; la pantalla única actual no expone ese recorrido. La aprobación de operador se cierra en F03-B.
- [x] F02-C · Google: credenciales, dev build nativo y recorrido de vinculación verificados en Desarrollo (emulador y teléfono, 13/09/2026).
- [ ] F02-C · Google en Pruebas: cliente Android con la firma de EAS, configuración de API y APK `preview`, recorrido real documentado.
- [ ] F02-C · Elegir proveedor SMS e implementar el adaptador real, con errores, límites y pruebas de contrato. Entrega real acotada en producción: F09.
- [ ] F02-C · Facebook: aplazado según decisión del 13/09; conservar deshabilitado hasta resolver configuración/verificación y certificarlo. Confirmar su inclusión antes de F09.

**Alcance y decisiones técnicas**

- Reemplazar las pantallas separadas de login/registro por **Continuar con teléfono**, con selector de país y prefijo +591 inicial. Normalizar a E.164; admitir números extranjeros cuando el proveedor y la configuración lo permitan.
- Flujo principal: **teléfono → código OTP → cuenta existente o completar nombre y términos → inicio**. El código llega por SMS en producción y se simula/autocompleta en desarrollo y pruebas. No pedir correo ni contraseña para usar este acceso. Resolver la existencia de la cuenta después de verificar el código, con respuestas que no permitan enumerar teléfonos registrados.
- Mantener **Continuar con Google** y **Continuar con Facebook**. El backend verifica la identidad del proveedor y, en el primer acceso sin teléfono verificado, solicita **número → OTP → completar datos/términos**. La identidad social por sí sola no permite pedir viajes ni conducir.
- Una sesión válida se conserva al reabrir la app. No enviar un SMS en cada apertura ni en cada viaje. Volver a verificar al cambiar el número, recuperar acceso o cuando una comprobación de seguridad lo exija.
- Modelar una cuenta interna estable y varias identidades vinculadas. El teléfono verificado debe ser único entre cuentas activas. Vincular Google/Facebook solo con confirmación explícita y prueba de ambas identidades; no fusionar por coincidencia de correo ni por un teléfono histórico sin verificar.
- Guardar desafíos OTP con caducidad, uso único, número, finalidad e identificador de proveedor. Limitar intentos, reenvíos y solicitudes por número, IP y dispositivo; contemplar códigos incorrectos, vencidos, SMS retrasados y errores del proveedor. No guardar códigos ni tokens en logs.
- Emitir credenciales operativas solo tras la verificación requerida; el alta debe ser idempotente para evitar duplicados ante reintentos o solicitudes simultáneas. Incorporar sesiones por dispositivo, rotación de refresh, detección de reutilización y revocación HTTP/WS.
- Permitir editar y verificar un nuevo número mediante reautenticación; revocar sesiones cuando corresponda. Si se pierde el número, ofrecer recuperación asistida y auditada, considerando números reciclados o cuentas en conflicto. En F02 se implementan la solicitud, el caso de uso protegido y su auditoría; la herramienta del operador y su recorrido completo se cierran con el panel en F03-B.
- Conservar ID, historial, rol y ganancias al vincular identidades sociales con prueba de ambas identidades y OTP. No elevar roles durante el alta; los conductores mantienen la aprobación de F04. La transición por contraseña histórica fue retirada por decisión explícita del 13/09, sin usuarios reales.
- Retirar correo/contraseña del flujo móvil nuevo. **Hecho el 13/09/2026, antes de producción y por decisión del usuario:** se eliminaron `/auth/register`, `/auth/login`, `/auth/oauth/{provider}` y `/auth/phone/link-legacy`, la migración `0026` borró los hashes y las cuentas sin teléfono verificado ya no pueden entrar (no había usuarios reales). No existe ningún flujo de contraseñas.
- Mantener la autenticación reforzada del panel administrativo; el acceso sencillo de pasajeros y conductores no elimina ese requisito. Conservar límites contra abuso en ofertas, solicitudes y WS, y tiempos de espera en verificaciones externas.


**OTP sin costo de proveedor en ambientes bajos**

- En **desarrollo y pruebas**, usar siempre un adaptador OTP simulado dentro del backend, sin llamadas de envío ni de verificación a Twilio u otro proveedor externo. Estos despliegues no reciben credenciales del proveedor SMS; no existe fallback a envíos reales si falla el simulador.
- Generar un código de prueba por desafío y conservar las mismas comprobaciones de finalidad, teléfono, caducidad, intentos y uso único del flujo normal. Evitar un código universal que permita saltarse la verificación.
- Solo el backend de un entorno bajo puede devolver el campo `test_code` en la respuesta del desafío. La variante móvil de ese entorno rellena automáticamente el formulario y muestra **OTP de prueba · sin SMS**. El usuario pulsa Continuar y el backend verifica el desafío; autocompletar no equivale a iniciar sesión automáticamente.
- Permitir desactivar el autocompletado en desarrollo para ingresar códigos erróneos y ensayar caducidad, reenvíos, límites y fallos simulados del proveedor. Los reintentos siguen siendo locales y gratuitos respecto al proveedor OTP.
- Aplicar esta simulación al acceso por teléfono, al paso OTP posterior a Google/Facebook y a las verificaciones de cambio de número/recuperación. Toda cuenta y verificación obtenida así permanece en su entorno aislado.
- Seleccionar el modo por configuración de despliegue validada al iniciar, no por parámetros enviados por la app ni por una flag comercial que pueda activarse en producción. El servidor productivo rechaza la configuración simulada, no devuelve `test_code` y no acepta desafíos ni tokens de entornos bajos. El build productivo excluye la ayuda de autocompletado de prueba.
- El autocompletado que el sistema operativo pueda ofrecer a partir de un SMS real en producción es independiente: ese SMS sí puede generar cargos. Aquí el ahorro se obtiene porque en ambientes bajos no se envía ni verifica nada con un proveedor externo.

**Aceptación:** se completa el flujo OTP de desarrollo con el campo autocompletado y **cero llamadas al proveedor externo**; producción conserva verificación real y no expone códigos de prueba. El costo de cómputo/hosting del simulador permanece dentro del presupuesto del entorno.

**Comprobación y evidencia:** OTP incorrecto, vencido y reutilizado; reenvíos; pérdida de sesión; altas concurrentes; vinculación social y migración conservando ID, rol e historial. Ausencia de test_code en el contrato productivo.

**Criterio de cierre de F02:** Alta, acceso, sesiones y cambio de número funcionan sin cuentas duplicadas ni cambios de rol, también en el APK actualizado de Pruebas. La solicitud de recuperación es accesible desde la app y su caso de uso/auditoría están probados; el recorrido con operador se cierra en F03-B. Entornos bajos hacen cero llamadas OTP; el adaptador productivo está implementado y probado por contrato sin permitir simulación. La entrega real de SMS se certifica en F09. Google se certifica en Pruebas; Facebook conserva un estado explícito de habilitado y certificado o aplazado y deshabilitado.

**Costo o dependencia externa:** OTP de desarrollo: cero cargos externos. Las cuentas OAuth y el adaptador real se preparan aquí; reservar presupuesto para certificar SMS productivo en F09.

### Fase 03. Países, panel base y feature flags

**Estado:** Pendiente de implementación. F03-A cuenta con el [plan 0011](../implementation-plans/0011-territorios-y-moneda.md); F03-B/C se pospusieron el 13/09, pero siguen siendo requisitos de apertura. **Responsable:** por asignar. **PR y evidencia de implementación:** por registrar.

**Objetivo:** Controlar el acceso administrativo y la disponibilidad por territorio, dejando preparada la expansión internacional.

**Dependencias:** F01–F02.

**Entregas en orden:**

- [ ] F03-A · País, zona, moneda y horario; Bolivia como configuración inicial.
- [ ] F03-B · Panel base, acceso reforzado, roles, auditoría y recuperación asistida.
- [ ] F03-C · Flags de backend y capacidades consumidas por la app.

**Ajuste previo a F03-A:** la cabecera actual de Alembic es `0028_driver_vehicles`; `0026` y `0027` ya están ocupadas. Crear revisiones posteriores a la cabecera vigente, sin reutilizar IDs. La zona `BO-ALL` preserva compatibilidad en entornos bajos; no equivale a habilitar comercialmente toda Bolivia. Definir zonas de apertura antes de F10.

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

**Estado:** En curso parcial, con trabajo adelantado integrado en el PR #15. **Ya implementado:** registro desde Perfil, un vehículo por tipo (`taxi`, `moto`, `truck`), servicios compatibles, estados de revisión y selección de modo/vehículo. **Falta:** documentación, revisión administrativa y operación de excepciones. **Responsable del cierre:** por asignar. **Evidencia:** migraciones `0027`/`0028`, casos de uso y pruebas de conductores; [revisión del 19/09](production-readiness-2026-09-19.md).

**Objetivo:** Habilitar conductores aprobados y resolver la operación normal y excepcional del viaje desde app y panel.

**Dependencias:** F02–F03.

**Entregas en orden:**

**Avance local del recorrido (revisión 21):** negociación simultánea, asignación única, llegada → «ya salí» → inicio → cierre y calificación. Se conservan comparación de ofertas, contacto visible, paneles estables y componentes compartidos. La llegada automática admite la respuesta válida de Google de 0 s junto al punto de recogida; los errores distinguen proveedor, ruta inexistente, timeout y conexión. Configuración muestra controles encima del mapa y búsqueda aprovecha el espacio medido, incluso con letra grande. Todos los mapas desactivan edificios/interiores/inclinación y ocultan geometrías de relieve. Evidencia: **396 pruebas móviles**, **68 casos UI**, **seis consultas reales a Google**, TypeScript/lint y bundle Android actualizado. La cartografía nativa y el sombreado al ampliar requieren confirmación en teléfono; no hay dispositivos ADB conectados. Backend sin cambios: revisión 17 con **731 pruebas backend** (90 omitidas y cinco advertencias existentes) y **9 PostgreSQL** en base desechable. No cierra seguimiento GPS compartido, navegación integrada ni cobros. [Llegada cercana y mapas 0021](../implementation-plans/0021-nearby-arrival-and-clear-maps.md).

- [x] F04-A · Alta y gestión de vehículos/servicios desde la app, estado pendiente y cambio de modo/vehículo.
- [ ] F04-A · Documentos privados, revisión/aprobación por operador, suspensión y vencimientos. Autoaprobación solo en entornos bajos; nunca sustituye este cierre.
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

**Estado:** Entrega local parcial: publicación GPS autorizada, WebSocket privado, recuperación por snapshot, señal antigua y servicio Android. Se probaron API/WS, Redis entre instancias y UI con dobles. Faltan ensayo con dos teléfonos, push y consultas propias de mapas desde backend. **Responsable de certificación:** por asignar. **Evidencia:** [0022](../implementation-plans/0022-driver-navigation-and-live-tracking.md).

**Objetivo:** Mantener ubicación y estado del viaje confiables para pasajero y conductor, con mapas y consumo controlados.

**Dependencias:** F04.

**Entregas en orden:**

- [x] F05-A · Reporte GPS autorizado, precisión y aviso de ubicación antigua; verificación local en 0022.
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

**Estado:** Entrega local parcial: Google Navigation 0.16.3 en Android, etapas por viaje activo, control de voz y Waze. Compilación y pruebas locales registradas en [0022](../implementation-plans/0022-driver-navigation-and-live-tracking.md); certificación con GPS real, cuenta Google y dos teléfonos pendiente. **Responsable de certificación:** por asignar.

**Objetivo:** Guiar dentro de ViajaYa hacia recogida y destino con Google Navigation, manteniendo Waze como opción externa.

**Dependencias:** F05; la prueba de compatibilidad nativa puede adelantarse a F01.

**Entregas en orden:**

- [x] F06-A · Wrapper 0.16.3 con Expo 56/RN 0.85.3: APK debug compilado y configuración regenerada; ver 0022. La certificación en teléfono sigue pendiente.
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

**Estado:** Pendiente de certificación operativa. Reutiliza Docker, workflow CI, salud/métricas, reglas de alertas y soporte multiworker implementados. El [plan 0008](../implementation-plans/0008-endurecimiento-arquitectura.md) aún exige rollout representativo y receptor/perímetro reales de monitoreo. **Responsable:** por asignar. **Evidencia alojada y del candidato:** por registrar.

**Objetivo:** Certificar el candidato completo en infraestructura alojada y comprobar seguridad, recuperación, costos y cumplimiento.

**Dependencias:** F01–F08 y disponibilidad de presupuesto/proveedores. Realizar los ensayos actuales en Desarrollo; acordar la infraestructura futura antes de la apertura.

**Entregas en orden:**

- [ ] F09-A · Infraestructura alojada, promoción, migraciones y observabilidad.
- [ ] F09-B · Integración, aislamiento, carga, restauración y rollback.
- [ ] F09-C · Privacidad, eliminación y certificación real de proveedores.

**Alcance y decisiones técnicas**

Arquitectura inicial propuesta: **Render de pago**, con API permanente, PostgreSQL administrado con réplica de disponibilidad, Redis/Valkey privado y panel estático. Validar la latencia desde redes móviles bolivianas antes de fijar región; Render actualmente no ofrece región sudamericana. [Regiones disponibles](https://render.com/docs/regions).

- Mantener Desarrollo separado de la futura Producción. Pruebas continúa deprecado y no debe reactivarse como parte implícita de esta fase.
- Crear imágenes reproducibles y despliegue automatizado con HTTPS/WSS.
- Ejecutar migraciones mediante un único proceso y comprobar compatibilidad antes de actualizar.
- Validar configuración productiva: secretos, conexiones y URLs; rechazar valores locales o inseguros.
- Completar la promoción gradual del sistema realtime existente y certificar dos réplicas.
- Centralizar errores de backend y Android, registros sanitizados, métricas y alertas con destinatario real.
- Proteger métricas y herramientas administrativas.
- Configurar backups, recuperación a un momento determinado y copia externa; ensayar restauración y rollback.
- Fijar versiones de dependencias, escaneo de secretos y controles obligatorios para integrar cambios.

**Flujo vigente: Desarrollo; publicación futura con aprobación**

- Desarrollo: implementar en una rama y enviar PR. CI ejecuta contratos y pruebas sobre bases temporales desechables; estas bases son recursos de test, no un cuarto entorno permanente.
- Validación actual en Desarrollo: identificar commit y APK, ejecutar QA funcional, OTP simulado, OAuth, pagos sandbox, navegación y realtime. Usar datos sintéticos y bases desechables para ensayos de esquema, restauración y rollback. No desplegar en Pruebas.
- Producción futura: acordar su habilitación y promover la imagen backend certificada, con configuración y secretos de producción. Ejecutar migraciones compatibles mediante un único proceso y comprobar salud; conservar la imagen anterior para rollback. No ejecutar suites destructivas o seeds de pruebas sobre datos reales.
- Android: generar las variantes de entorno desde el mismo commit. Como sus identificadores y credenciales son diferentes, certificar también el AAB productivo firmado en la pista interna/cerrada de Google Play antes de promover ese mismo AAB al público. Una pista de distribución no cambia automáticamente la API a la que apunta el binario.
- Registrar versión, entorno, resultado de pruebas y responsable de promoción. El despliegue público queda bloqueado si fallan las comprobaciones, existen secretos cruzados o quedan simulaciones activadas. Los cambios nativos requieren un binario compatible; las actualizaciones móviles no deben cruzar entornos.

**Privacidad y certificación de proveedores**

- Publicar términos, privacidad, soporte y condiciones de conductores.
- Guardar aceptación versionada de términos.
- Implementar solicitud de eliminación, anonimización y reglas de conservación por categoría.
- Proporcionar eliminación desde la app y una vía web accesible: Google Play exige ambas para aplicaciones que crean cuentas. [Política de eliminación](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN).
- Certificar Google y cualquier otro proveedor social habilitado con firmas y credenciales de producción. Registrar la decisión sobre Facebook; si sigue aplazado, comprobar que permanece deshabilitado.
- Ejecutar la certificación técnica y de cumplimiento de la sección 5 y registrar evidencia del candidato, entorno y versión. Los hitos de distribución, revisión y aceptación de Google Play se cierran en F10 y no son requisitos de cierre de F09.
- Certificar OTP real exclusivamente en producción mediante un ensayo acotado y presupuestado; desarrollo mantienen siempre la simulación. Certificar OAuth con firmas productivas y QR real con su proveedor.
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
- [x] Definir el contrato de entorno y su validación: desarrollo/producción, URLs, emisor/audiencia, credenciales por proveedor y modos permitidos.
- [x] Documentar la matriz OTP: simulación obligatoria en desarrollo, proveedor real exclusivamente en producción; el autofill llega en F02.
- [x] Actualizar configuración y ejemplos de ambos proyectos y comprobar aceptación de combinaciones válidas y rechazo de cruces/modos inseguros.
- [x] Registrar evidencia local de F01-A, F01-B y F01-C. F02-A/B/C ya tiene implementación; los siguientes cierres están en la tabla de próximas entregas.

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

La respuesta OTP de desarrollo puede incluir `test_code` para el autocompletado. El contrato productivo no incluye ese campo; CI debe certificar su ausencia y el rechazo de cualquier solicitud que intente activar el modo simulado desde el cliente.

## 4. Presupuesto y control del gasto

**Conviene separar el costo fijo de mantener el servicio del costo variable de cada operación.** Sin presupuesto definido, estas referencias permiten decidir cuándo contratar y cuánto reservar.

Estimaciones mensuales en USD. Referencias iniciales del **9 de septiembre de 2026**; tarifas públicas de Google Maps/Navigation, Twilio Verify y EAS reconsultadas el **19/09/2026**. Las bandas de infraestructura se conservan como hipótesis propia pendiente de cotización detallada; no son gasto observado ni presupuesto aprobado.

| Concepto | Apertura acotada | Preparación para la capacidad objetivo |
|---|---:|---:|
| Infraestructura futura, backups y monitoreo (estimación histórica por revisar) | **300–400** | **700–1.000** |
| Mapas | Según búsquedas y rutas | Puede superar al costo de infraestructura |
| Navegación Google integrada | Según destinos solicitados al SDK | Ejemplo de dos destinos por viaje: USD 6.475/mes |
| OTP en desarrollo | **0 USD de envío/verificación externa**, mediante simulación y autocompletado | **0 USD de envío/verificación externa**; hosting contabilizado aparte |
| OTP real en producción | Según altas, inicios que requieran OTP, cambios de número y reintentos | Según consumo y país; no equivale a SMS por viaje |
| Correo transaccional | Según proveedor y volumen | Según proveedor y volumen |
| Pasarela y liquidaciones | Según contrato y volumen cobrado | Según contrato y volumen cobrado |
| Desarrollo, soporte, seguros y obligaciones comerciales | Presupuesto separado | Presupuesto separado |

Las bandas de infraestructura de esta tabla son históricas e incluían un entorno de Pruebas alojado. **No son el presupuesto vigente:** Pruebas está deprecado y solo se usa Desarrollo. Se recalculará el alojamiento productivo antes de contratarlo; las cifras no acreditan capacidad. El consumo de APIs de Desarrollo se mide por separado.

Para dimensionar mapas: **5.000 viajes/día × 30 días × 2 rutas = 300.000 cálculos mensuales**, aproximadamente **USD 1.250 en Routes Essentials**. Añadiendo, como hipótesis, un detalle Essentials y cinco solicitudes de autocompletado por viaje, el conjunto sería aproximadamente **USD 3.488/mes**, antes de geocodificación, búsquedas abandonadas y recálculos adicionales. [Tarifas de Google Maps](https://developers.google.com/maps/billing-and-pricing/pricing).

Ese escenario base daría **unos USD 4.200–4.500 mensuales entre infraestructura y mapas, sin navegación giro a giro**. Corresponde a la meta de 5.000 servicios diarios; no representa el costo de un piloto pequeño ni un presupuesto aprobado. Antes de contratar, calcular otro escenario con la cantidad esperada de servicios, búsquedas abandonadas y accesos del piloto.

**Costo adicional de navegación integrada.** A 5.000 viajes/día durante 30 días, un destino de navegación por viaje suma 150.000 destinos (aproximadamente **USD 3.475/mes**); dos destinos, recogida y entrega, suman 300.000 (aproximadamente **USD 6.475/mes**). Con el supuesto conservador de conservar las consultas de mapas anteriores, infraestructura + mapas + dos destinos de navegación serían **unos USD 10.700–11.000/mes**, antes de SMS, pasarela, impuestos y operación humana. Son escenarios de uso a tarifa pública, no una cotización ni el costo de empezar. [Tarifas de Navigation Request](https://developers.google.com/maps/billing-and-pricing/pricing).

La facturación depende de destinos solicitados y del contrato; iniciar la guía y los desvíos automáticos posteriores no tienen un cargo adicional por sí mismos. Evitar consultas duplicadas entre Routes y el SDK y medir si la integración permite reducir el supuesto anterior. Pedir condiciones de movilidad/volumen sin asumir descuentos. [Facturación de Navigation SDK](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing).

Otros consumos que deben quedar visibles:

- Verificación real en producción: Twilio Verify publica USD 0,05 por verificación exitosa **más el costo del canal**; 1.000 verificaciones serían USD 50 antes del SMS aplicable a Bolivia. Cotizar entrega y tarifa local antes de elegir proveedor. Desarrollo y pruebas no consumen este servicio. [Precios de Verify](https://www.twilio.com/en-us/verify/pricing).
- Compilaciones y actualizaciones: EAS tiene nivel gratuito y Starter de USD 19/mes más consumo. Elegir según uso real. [Precios de Expo](https://expo.dev/pricing).
- Cobros: calcular comisiones de pasarela, liquidaciones y devoluciones sobre el contrato real; no asumir que recibir QR es gratuito.

Implementar en Desarrollo; conservar medición y límites independientes para una futura Producción:

- Indicadores de costo por entorno, búsqueda, viaje, destino de navegación y país. Medir envío/verificación OTP, entrega y reintentos SMS solo para producción; en desarrollo registrar desafíos simulados y comprobar cero llamadas al proveedor externo.
- Alertas al 50 %, 80 % y 100 % del presupuesto configurado.
- Cuotas y límites de consumo, además de alertas: una alerta presupuestaria por sí sola no detiene cargos. [Control de costos de Maps](https://developers.google.com/maps/billing-and-pricing/manage-costs).
- Control de abuso, campos mínimos de Places y límites de recálculo.
- Margen por servicio: **comisión ingresada menos pasarela, consumo tecnológico, ajustes y devoluciones**.

## 5. Pruebas y condiciones para abrir al público

Ejecutar cada fase mediante los PR sugeridos y comprobar sus criterios antes de cerrarla. La siguiente matriz es transversal: cada comportamiento se prueba en su fase; F09 cierra integración técnica, cumplimiento, carga y recuperación. F10 cierra los hitos de distribución y aceptación de Google Play y confirma la preparación operativa de cada zona. Ningún hito exclusivo de F10 es requisito para cerrar F09.

La apertura requiere:

- CI completa aprobada: backend, PostgreSQL/Redis, contratos, TypeScript, lint y pruebas mobile.
- Desarrollo identificado correctamente y separado de la futura Producción: tokens, webhooks y actualizaciones no cruzan entornos. Pruebas permanece deprecado. Limpiar recursos de Desarrollo o CI no debe afectar datos productivos futuros.
- Promoción backend por la misma imagen certificada y revisión del AAB productivo antes de publicar. Confirmar rechazo de secretos cruzados, OTP simulado/fijo, autocompletado de prueba y pasarela simulada en producción; para correo/push de pruebas, comprobar la lista de destinatarios autorizados.
- Desarrollo: recorrer alta por teléfono, OTP posterior a Google y a cualquier proveedor social habilitado, y cambio de número con autocompletado, verificando cero llamadas al proveedor SMS tanto al enviar como al validar y reenviar. Desactivar autocompletado para comprobar códigos incorrectos, caducidad y uso único.
- Producción: certificar que ni parámetros, headers, flags ni un build de entorno bajo habiliten el simulador o devuelvan `test_code`. La entrega real de SMS se comprueba con el proveedor productivo de forma acotada y presupuestada; las pruebas simuladas no la sustituyen.
- Recorrido real en dos teléfonos para taxi, moto y encomienda, incluyendo efectivo y QR.
- Pruebas de alta e inicio por teléfono, OTP válido/incorrecto/vencido/reutilizado, reenvío, demora del SMS, abuso, cambio de número y recuperación sin pantallas bloqueadas.
- Google y cualquier proveedor social habilitado con y sin teléfono verificado; vinculación explícita, teléfono ya registrado, altas concurrentes y migración de cuentas existentes sin perder historial ni elevar roles. Verificar que no se emitan sesiones operativas antes del OTP requerido y que Facebook siga deshabilitado si continúa aplazado.
- Pruebas de sesión inválida, cuenta suspendida y revocación; comprobar 404 en los endpoints retirados de correo/contraseña y rechazo de JWT sin sesión administrada.
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

## 6. Decisiones necesarias para fijar la salida

| Decisión | Estado al 19/09 | Debe resolverse antes de |
|---|---|---|
| Ciudad/zona inicial, volumen del piloto y responsables/horarios de soporte | No consta una selección cerrada en los planes revisados | Configurar cobertura en F03/F04 y abrir en F10 |
| Proveedor SMS, entrega en Bolivia y presupuesto de ensayo real | Sin proveedor elegido en la última evidencia | Cierre de F02-C y certificación F09 |
| Proveedor QR, comisión, liquidaciones, devoluciones y deuda por efectivo | Por definir/cotizar | Integración F07 y apertura F09–F10 |
| Presupuesto máximo mensual y alojamiento/región | Estimaciones, sin contratación certificada | Aprovisionar y certificar F09 |
| Cuenta Google Play, titular y tipo de cuenta | No verificado | Calendarizar F10; comprobar si aplica la prueba de 12 testers/14 días |
| Facebook en la primera salida | Aplazado; debe permanecer deshabilitado hasta certificación | Cerrar el alcance social de F09 |
| Mudanzas/camioneta en la primera salida | Implementación parcial en código, fuera del alcance de apertura acordado | Habilitar comercialmente `moving` |

**Regla de actualización:** cada cierre registra fecha, commit, entorno, comando o recorrido, resultado y límites. Los resultados históricos de otra versión se conservan como antecedente y se distinguen de la certificación del candidato actual.
