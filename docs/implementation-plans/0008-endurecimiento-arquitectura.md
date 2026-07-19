# Plan 0008 — Endurecimiento arquitectónico y escalado del tiempo real

> **Estado:** en ejecución.
> **Creado:** 2026-07-18.
> **Alcance:** backend, mobile, contrato compartido y operación.
> **Estrategia:** evolución incremental del monolito modular; no se divide en
> microservicios.

## Contexto

La arquitectura actual separa dominio, aplicación, infraestructura y API, y ya
protege las carreras principales de la negociación con operaciones atómicas.
Las comprobaciones de calidad están verdes, pero hay tres límites que impedirían
escalar el despliegue con seguridad:

1. El hub WebSocket, la presencia y los temporizadores viven en memoria del
   proceso. Dos workers no comparten conexiones, presencia ni eventos.
2. Algunas vistas reconstruyen información con consultas por cada fila o cargan
   historiales completos para encontrar un único resultado.
3. El contrato mobile confía en casts TypeScript para datos HTTP/WS y mezcla
   tipos geográficos compartidos con adaptadores de ubicación de un feature.

Mientras el transporte siga en memoria, el backend debe ejecutarse con **un solo
worker**. Esta restricción es operativa, no una garantía permanente.

## Objetivos

- Mantener el monolito modular y sus límites de Clean Architecture.
- Separar lecturas enriquecidas de repositorios transaccionales.
- Poder ejecutar varios procesos API sin perder presencia ni eventos.
- Persistir eventos y acciones diferidas antes de considerarlos confirmados.
- Hacer el cliente tolerante a duplicados, reordenamientos y contratos inválidos.
- Añadir pruebas PostgreSQL para las garantías que SQLite no puede representar.

## Fuera de alcance

- Separar servicios por dominio o introducir microservicios.
- Cambiar la regla de que el pasajero decide la negociación.
- Sustituir PostgreSQL como fuente de verdad.
- Eliminar el polling de respaldo antes de comprobar el nuevo transporte en
  producción.
- Implementar seguimiento de ubicación en segundo plano.

## Decisiones de diseño

### Monolito modular

La aplicación seguirá desplegándose como una unidad. Redis será infraestructura
de coordinación, no una nueva fuente de verdad del negocio. PostgreSQL conserva
rides, ofertas, estados, eventos pendientes y acciones diferidas.

### Lecturas separadas

Las vistas que combinan ride, participantes, oferta y rating dependerán de un
puerto de lectura de la capa de aplicación. El adaptador SQLAlchemy devolverá
proyecciones completas sin exponer modelos ORM ni mover lógica de autorización a
infraestructura.

### Entrega al menos una vez

Los eventos durables podrán entregarse más de una vez. Cada envelope tendrá
`event_id`, `aggregate_id`, `aggregate_version`, `stream`, `stream_version`,
`occurred_at`, `type` y `data`. La versión de agregado ordena eventos relacionados
con el mismo agregado, incluso entre fanouts; la versión de stream ordena lo que
ve cada topic y permite detectar huecos reales. El cliente deduplicará por
`event_id`, solo aplicará la siguiente posición contigua del stream y pedirá un
resnapshot ante un salto. Los snapshots llevarán un vector acotado de watermarks:
exactamente `ride:{id}` para el pasajero; `pool:{vehicle_type}`,
`pool:delivery` y `driver:{id}` para el conductor.

`event_id` identifica una fila/entrega concreta de outbox; los fanouts de una
misma mutación comparten `batch_id`, pero tienen IDs distintos. Un
`aggregate_version` menor recibido por otro stream no se descarta globalmente:
puede representar un delta que la proyección local aún necesita. Los guards de
versión por agregado deben vivir en el reducer de cada proyección cuando el
evento más nuevo sea un estado completo que realmente sustituya al anterior.

### Fallo seguro de presencia

Una caída de Redis o del worker nunca debe cancelar un ride que podría seguir
atendido por un pasajero conectado. Ante duda, el sistema conserva la búsqueda y
el polling permite converger; el reaper recuperará el trabajo cuando vuelva la
infraestructura.

## Fase 0 — Mejoras locales sin cambiar contratos

### 0.1 Proyecciones críticas del backend

- Crear un puerto `RideReadRepository` en aplicación.
- Resolver el viaje activo del conductor con filtro de estado y `LIMIT 1`.
- Resolver historial con contraparte, precio acordado y rating en una consulta.
- Resolver la proyección de ganancias en una consulta, manteniendo el cálculo de
  día de negocio en `America/La_Paz`.
- Mantener intactos los schemas HTTP y los eventos WebSocket.

### 0.2 Shared kernel geográfico mobile

- Mover `Coordinates` y `PlaceLabel` a `src/core/domain/geo.ts`.
- Evitar que `booking/domain` dependa de `home/data`.
- Conservar reexports temporales para no forzar una migración masiva.

### Criterios de aceptación

- Los tres casos de lectura ejecutan una consulta principal cada uno.
- Los resultados conservan orden, contraparte, precio, rating y zona horaria.
- `booking/domain` no importa desde ninguna capa `data`.
- Pytest, Ruff, TypeScript y ESLint pasan.

## Fase 1 — Escalado de lecturas e integridad PostgreSQL

> **Progreso:** la migración `0017_pg_integrity_indexes` implementa la FK,
> restricciones e índices descritos abajo. Historial y pool ya exponen páginas
> con cursor keyset y mobile las consume con React Query infinito. `0017` pasó el
> ciclo `0016 → 0017 → 0016 → 0017` y la carrera de asignación en una base
> PostgreSQL desechable; no se aplicó a la base local `viajaya`. Aún falta llevar
> la migración a un entorno desplegado y comprobar `EXPLAIN` con volumen
> representativo. El workflow CI ya ejecuta la suite opt-in, pero su primera
> corrida remota depende de publicar estos cambios.

### Paginación

- [x] Añadir cursor estable a historial y pool abierto, basado en
  `(created_at, id)`.
- [x] Definir límite máximo de 100 y respuesta con `items` y `next_cursor`.
- [x] Actualizar repositorios, schemas, DTO mobile, snapshot WebSocket y React
  Query en la misma entrega.
- [x] Mantener ganancias agregadas en SQL; devolver solo los 10 viajes recientes.

### Índices implementados

Crear una migración Alembic revisada manualmente y comprobar los planes con
`EXPLAIN (ANALYZE, BUFFERS)` sobre datos representativos:

- `ride_requests(service_type, created_at DESC, id DESC)` parcial para solicitudes
  `SEARCHING` no pausadas del pool.
- `ride_requests(driver_id, status, created_at DESC, id DESC)` para viaje activo e historial.
- `ride_requests(rider_id, status, created_at DESC, id DESC)` para recuperación e historial.
- `offers(ride_id, status, created_at DESC, id DESC)` y
  `offers(driver_id, status, created_at DESC, id DESC)`.
- Índice único parcial para impedir más de un ride asignado activo por conductor.

Añadir además FK para `accepted_offer_id` y restricciones de base para montos,
ETA, ratings y versiones del pool. La migración ejecuta un preflight antes del
DDL y aborta con el detalle de los datos incompatibles; no los repara ni elimina
silenciosamente.

### Pruebas PostgreSQL

La suite `tests/postgresql/` certifica el ciclo completo de `0017`, sus
restricciones, FK e índices, y las siguientes carreras con conexiones realmente
concurrentes. `.github/workflows/ci.yml` la ejecuta contra PostgreSQL 16 en un
job separado:

- [x] dos aceptaciones sobre el mismo ride;
- [x] aceptación contra cancelación manual y por ausencia;
- [x] ofertas simultáneas del mismo conductor;
- [x] intento de asignar un conductor a dos rides activos;
- [x] ratings concurrentes del mismo usuario.

SQLite se conserva para la suite rápida, pero no certifica `FOR UPDATE`, índices
parciales ni niveles de aislamiento.

## Fase 2 — Contrato HTTP/WS validado y versionado

### HTTP

- [x] Exportar un snapshot OpenAPI determinista y comprobar su vigencia en CI.
- [x] Generar tipos TypeScript reproducibles desde OpenAPI y consumirlos
  gradualmente en los repositorios mobile. Los DTO centrales de viajes, ofertas
  y pool ya referencian el contrato generado.
- [x] Mantener mappers explícitos DTO `snake_case` → dominio `camelCase`.
- [x] Detectar cualquier drift del schema como fallo de CI. La clasificación
  automática entre cambios compatibles e incompatibles queda pendiente junto
  con una herramienta de diff semántico.

El generador vive aislado en el paquete de tooling de la raíz y solo produce
tipos: no añade otro cliente HTTP ni reemplaza los mappers. Historial y ganancias
mantienen DTO manual por ahora, porque sus schemas OpenAPI todavía exponen
campos opcionales que deben normalizarse explícitamente antes de adoptarlos.

### WebSocket

- [x] Definir los 15 envelopes y payloads actuales como schemas Pydantic
  discriminados y construirlos antes de toda emisión.
- [x] Mantener schemas Zod equivalentes por socket en mobile.
- [x] Parsear cada mensaje antes de mutar React Query o Zustand.
- [x] Extraer reducers puros para las ofertas del pasajero y los estados de ride
  compartidos; `openRidesCache` ya reduce el pool del conductor. Los hooks
  conservan únicamente la coordinación del socket, caché, stores y efectos UI.
- [x] Registrar eventos inválidos con metadatos sanitizados, sin incluir tokens,
  URL, frame ni payload.

El consumidor mobile es deliberadamente tolerante a campos adicionales para
permitir extensiones compatibles del payload; continúa rechazando tipos
desconocidos, campos obligatorios ausentes y valores inválidos.

### Compatibilidad

Durante una versión de transición, el cliente aceptará el envelope actual y el
nuevo envelope versionado. El backend solo retirará el formato anterior cuando la
versión mínima soportada de la app ya entienda el nuevo contrato.

La subfase 2.1 conserva el envelope actual `{type, data}`. No se añadirán
`event_id` ni `aggregate_version` efímeros: esas garantías deben nacer de la
misma transacción que la mutación mediante la outbox de la fase 3. Añadirlos
antes crearía una falsa garantía de orden y durabilidad.

La base del contrato v2 ya está implementada, pero todavía no está conectada al
socket en vivo. Backend dispone de schemas estrictos para el envelope durable y
los snapshots unificados, además de un serializador que traduce batches
canónicos de outbox. Mobile conserva los parsers legacy y ofrece parsers duales:
si un frame incluye cualquier clave reservada de v2 debe satisfacer el contrato
v2 completo y nunca degrada silenciosamente a legacy. Ambos lados limitan
versiones y secuencias al máximo entero seguro de JSON.

El snapshot del pasajero contiene `{ride, offers}` y un único watermark. El del
conductor contiene `{open_rides, paused_rides, offers, active_ride}` y los tres
streams que realmente consume. `snapshot_id` y `captured_at` identifican la
captura. Un `RealtimeSnapshotReader` especializado ya construye ambas
proyecciones con una sesión corta propia. En PostgreSQL, su primera sentencia
fija `REPEATABLE READ READ ONLY`; estado, reloj de base y watermarks se leen bajo
ese mismo corte, preservando el orden solicitado y usando versión `0` cuando el
stream todavía no tiene contador. La captura solo filtra ofertas vencidas: no
ejecuta DML ni mantenimiento, y sus consultas enriquecidas evitan N+1 en ofertas
del pasajero y rides pausados del conductor.

La prueba PostgreSQL opt-in pausa la captura entre estado y watermarks, confirma
una escritura concurrente y demuestra que ambos permanecen en la versión
anterior. Una captura nueva verá ambos valores nuevos. Los casos de uso derivan
los streams autorizados y un adaptador API traduce los DTO enriquecidos al schema
Pydantic sin IO adicional. El WebSocket todavía no invoca este reader ni emite
los snapshots v2: presencia sigue en memoria y solo creación/reemplazo,
aceptación de ofertas y pausa para edición alimentan la outbox, por lo que
activarlos aún daría watermarks incompletos.

Mobile incluye además un gate puro de replay. Decide `apply`, `drop` o `resync`
sin adelantar cursores y solo los confirma después de que el handler complete la
mutación de caché. Así un fallo del handler permite reintentar el evento. El gate
deduplica la misma entrega y detecta reutilización contradictoria de `event_id`
incluyendo una huella canónica de `{type, data}`. Todavía no está cableado a
`useNegotiationSocket`: hacerlo requiere que el
backend entregue primero el snapshot consistente y que el socket pueda solicitar
una resincronización controlada.

### Pruebas

- [x] Snapshot seguido de deltas en los e2e WebSocket existentes.
- [x] Retry exacto de una entrega en el gate puro; reutilizar el mismo `event_id`
  con otro stream, metadata o payload fuerza resnapshot.
- [x] Evento atrasado con menor `aggregate_version` en otro stream: se conserva
  el delta si su posición de stream es contigua, sin regresiones globales.
- [x] Snapshot más nuevo que los eventos locales y rechazo de snapshots viejos.
- [ ] Integrar el gate al socket y certificar duplicados, huecos y resnapshot con
  el transporte WebSocket real.
- [x] Payload inválido, razón inválida y tipo desconocido en el contrato backend.
- [x] GET HTTP iniciado antes que un evento WebSocket y resuelto después: una
  prueba con `QueryClient` real certifica que la caché conserva el evento.
- [x] Mutación HTTP que devuelve un estado anterior después de un terminal WS:
  los callbacks consultan primero el detalle canónico y no reviven el ride.

La barrera actual solo impide regresiones desde estados terminales. Ordenar dos
estados no terminales concurrentes requiere `aggregate_version` y queda ligado a
la outbox de la fase 3. `cancelQueries` protege la caché aunque el transporte
Axios todavía continúe en segundo plano sin propagar `AbortSignal`.

## Fase 3 — Tiempo real durable y multiworker

### 3.1 Unidad de trabajo y outbox

> **Progreso:** `0018_realtime_outbox` crea la outbox y el contador transaccional
> por agregado. `0019_realtime_stream_versions` añade un contador independiente
> por topic, `stream_version`, su backfill determinista y los índices para
> preservar el orden visible de cada stream.
> `0020_realtime_outbox_quarantine` separa la cuarentena terminal de la
> publicación y del retry transitorio. Un error determinista de contrato aparta
> todo el batch con un código estable, deja de bloquear sus streams y conserva
> las filas para auditoría; el hueco resultante obliga a resnapshot antes de
> continuar el replay live.
> `CreateOffer`/reemplazo, `AcceptOffer` y `PauseRideForEdit` son los primeros
> productores: mutación, batch ordenado y versiones se confirman en un solo commit mediante
> `UnitOfWork`; la publicación directa reutiliza exactamente los payloads
> persistidos. El fanout de aceptación conserva `ride_status`, cierre del pool,
> notificación/limpieza del ganador y retiros/rechazos de los afectados en un
> único batch multistream. El recorder está detrás
> de `REALTIME_OUTBOX_RECORDING_ENABLED=false` y el dispatcher se controla con
> `REALTIME_OUTBOX_DISPATCH_MODE=off|shadow`, también apagado por defecto. El modo
> sombra únicamente reclama, valida y marca batches: no entrega al hub WebSocket
> ni a Redis. Esta vertical no incorpora modo `live` ni habilita múltiples
> workers. El lifecycle ya realiza preflight del esquema actual, usa una sesión
> nueva por iteración y detiene el loop de forma coordinada. El contrato v2 y su
> serializador ya pueden representar esos batches, y mobile ya puede validarlos y
> decidir su replay de forma pura; ninguna de esas piezas está habilitada en el
> socket vivo todavía. Los builders de snapshots ya disponen de un corte
> consistente y read-only, pero siguen desacoplados del handshake por la misma
> condición de rollout.
> `0018`–`0020` no se aplicaron a la base local `viajaya`; sus pruebas PostgreSQL son
> opt-in y CI las ejecutará sobre una base desechable.

Para publicar un evento después de un commit sin ventana de pérdida, la mutación
y el registro del evento deben pertenecer a la misma transacción. Se introdujo
una `UnitOfWork` en aplicación de forma incremental; los repositorios migrados
hacen `flush` y la unidad de trabajo decide `commit`/`rollback`.

Esquema actual de `realtime_outbox`:

- `id UUID` (`event_id`);
- `event_type`, `topic`;
- `aggregate_type`, `aggregate_id`, `aggregate_version`;
- `stream_version`, único y creciente dentro de cada `topic`;
- `payload JSONB`;
- `created_at`, `published_at`;
- `quarantined_at`, `quarantine_code` para salida terminal explícita;
- `attempts`, `last_error`.

La implementación añade además `batch_id` + `sequence` para preservar el orden
de fanouts y `next_attempt_at` para evitar reintentos calientes. La tabla
`realtime_aggregate_versions` asigna versiones dentro de la transacción; no se
reutiliza `pool_version`, porque ese contador no cambia en todos los eventos.
`realtime_stream_versions` reserva rangos por topic en la misma transacción. Los
productores adquieren primero los contadores de agregados y luego los de streams,
ambos en orden determinista, para evitar deadlocks en batches multi-topic.

El claim solo considera un batch si ninguno de sus miembros tiene una fila
anterior sin publicar en el mismo topic. `SKIP LOCKED` permite que otro dispatcher
avance streams independientes, pero nunca que adelante una versión posterior del
mismo stream. Un fallo transitorio conserva ese bloqueo y usa backoff. Un batch
inválido se cuarentena completo en el primer intento: deja de participar en los
predicados pending y libera sus streams solo después del commit. Sus versiones
no se reutilizan; el hueco obliga a un cliente live a solicitar otro snapshot.

Un dispatcher reclamará filas con `FOR UPDATE SKIP LOCKED`, publicará en Redis y
marcará `published_at`. Si muere después de publicar y antes de marcar, el evento
se repetirá; por eso la idempotencia del cliente es obligatoria.

El primer dispatcher es deliberadamente **sombra** y no ejecuta esa publicación:
certifica el claim, la validación y el lifecycle usando la outbox real, marca las
filas procesadas y deja la entrega directa actual como única vía visible. Exige
que `0018`, `0019` y `0020` estén aplicadas antes de
habilitarlo. La secuencia de flags es:

1. `off` + recording `false`: estado seguro y predeterminado;
2. `shadow` + recording `false`: comprobar arranque/apagado y drenar cualquier
   backlog previo sin entregarlo;
3. `shadow` + recording `true`: registrar y depurar en sombra mientras se compara
   con la publicación directa.

`off` + recording `true` no es una combinación desplegable. Antes de una futura
entrega real se debe comprobar que no quede backlog sombra reproducible. Cambiar
estos flags no permite aumentar el número de workers API.

Las operaciones atómicas de aceptación, cancelación, pausa y creación/reemplazo
de oferta serán las primeras en migrar. No se retirará la publicación directa
hasta que la outbox funcione en modo sombra y sus métricas coincidan.

Base ya cumplida por `93b9741`:

- [x] Crear esquema, índices, constraints y downgrade de `0018`.
- [x] Reclamar batches completos con `FOR UPDATE SKIP LOCKED` y liberarlos al
  hacer rollback.
- [x] Migrar creación/reemplazo de oferta a `flush` + outbox + commit del UoW.
- [x] Reutilizar el mismo builder canónico para outbox y WebSocket directo.
- [x] Proteger el producer con un feature flag apagado por defecto para no crear
  un backlog histórico imposible de reproducir con seguridad.
- [x] Añadir `0019`, reservar posiciones por stream sin deadlocks y evitar que
  claims concurrentes adelanten un batch del mismo topic.
- [x] Definir y probar el envelope v2, snapshots con watermarks, parser dual
  mobile y gate puro de idempotencia sin cambiar la emisión actual.
- [x] Capturar estado y watermarks v2 bajo una única transacción PostgreSQL
  `REPEATABLE READ READ ONLY`, sin mutaciones ni N+1 en las colecciones críticas.
- [x] Migrar la aceptación atómica a `flush` + outbox + commit del UoW y
  reutilizar el mismo batch canónico en la publicación directa.
- [x] Migrar pausa para edición al mismo UoW; capturar el detalle enriquecido
  antes del commit y preservar `ride_closed → offer_withdrawn → ride_paused`.
- [x] Añadir `0020` y cuarentena terminal atómica para batches inválidos, con
  códigos cerrados, índices que excluyen terminales y downgrade protegido.

Dispatcher sombra, sin Redis ni cambios de contrato/mobile:

- [x] Ejecutar el dispatcher en modo sombra con lifecycle y apagado coordinado.
- [x] Validar antes de marcar que lote, secuencia, `event_id`, versión,
  `event_type`, topic y payload canónico coincidan; errores deterministas usan
  cuarentena sanitizada y solo fallos transitorios conservan backoff.
- [ ] Activarlo en un entorno con `0018`–`0020`, depurar el backlog sombra y
  comparar sus batches con la publicación directa antes de habilitar entrega real.
- [ ] Medir pendientes y edad máxima, y definir retención de filas publicadas.
- [ ] No habilitar entrega real hasta que el envelope lleve `event_id`, versiones
  de agregado/stream en el socket vivo y el gate mobile esté integrado.
- [ ] Migrar cancelación, resolviendo versiones de los otros rides afectados por
  cada fanout.

### 3.2 Bridge Redis y sockets locales

- Cada proceso mantiene únicamente sus sockets locales.
- Un suscriptor Redis por proceso recibe eventos y los entrega al hub local.
- Los topics lógicos existentes (`ride:*`, `driver:*`, `pool:*`) se conservan.
- La barrera de snapshot se toma después de registrar la suscripción local; los
  duplicados que coincidan con el snapshot se resuelven por versión.
- Reconectar Redis tiene backoff, métricas y resnapshot del cliente por el flujo
  WebSocket existente.

Solo después de pasar las pruebas multiworker se permitirá configurar más de un
worker API.

### 3.3 Presencia compartida

- Redis mantendrá **leases por conexión**, no un booleano único por ride. Una
  representación posible es un sorted set `presence:ride:{ride_id}` cuyos
  miembros sean `ws:{connection_id}` y `http`, con la expiración como score.
- El gateway renovará su miembro periódicamente mientras el WS siga vivo; el
  endpoint `GET /rides/me/active` renovará el miembro HTTP.
- Scripts Lua podarán miembros vencidos y comprobarán presencia sin una carrera
  entre dos conexiones o procesos. Desconectar una conexión nunca elimina la
  presencia aportada por otra.
- Al desaparecer el último lease se hará upsert de una acción durable
  `cancel_absent_ride` para `now + 120 s`. Una reconexión o heartbeat incrementará
  su `generation` y moverá la fecha límite, invalidando ejecuciones anteriores.
- El reaper solo cancelará si el ride sigue `SEARCHING`, no está pausado, venció
  la generación vigente y Redis no confirma ningún lease vivo.
- Si Redis no está disponible, el reaper aplaza la cancelación.

### 3.4 Expiraciones y acciones diferidas

Sustituir `asyncio.create_task` por una tabla `scheduled_actions`:

- `id`, `dedupe_key`, `action_type`, `aggregate_id`, `generation`;
- `execute_at`, `payload JSONB`;
- `status`, `attempts`, `next_attempt_at`, `locked_at`, `last_error`.

La creación de la oferta insertará `expire_offer` en la misma transacción. La
actividad de presencia hará upsert de `cancel_absent_ride`. Workers concurrentes
reclamarán acciones con `FOR UPDATE SKIP LOCKED`; los casos de uso atómicos
seguirán siendo la defensa final contra carreras.

## Despliegue incremental

1. Publicar métricas y documentar el límite actual de un worker.
2. Aplicar `0018`–`0020` y desplegar las tablas de outbox sin consumidores.
3. Desplegar el dispatcher en `off` y luego activar `shadow` con recording
   `false` para certificar lifecycle y drenar backlog.
4. Activar recording en sombra y comparar batches, payloads y métricas contra la
   publicación directa, todavía con un worker.
5. Emitir envelopes versionados y actualizar mobile para idempotencia y
   watermarks.
6. Activar Redis bridge con un worker API y comparar eventos/snapshots.
7. Desactivar temporizadores y publicación directa mediante feature flags.
8. Probar reinicios forzados de API, Redis y workers.
9. Habilitar dos workers API en staging; luego producción.

Cada paso debe tener un feature flag y rollback que no revierta migraciones ni
borre eventos pendientes.

## Observabilidad mínima

- Conexiones WS locales por topic y proceso.
- Latencia commit → publicación y tamaño de outbox pendiente.
- Acciones programadas vencidas, reintentos y fallos definitivos.
- Renovaciones y expiraciones de presencia.
- Reconexiones Redis y mensajes descartados por versión/schema.
- Request/correlation ID propagado a logs y eventos.
- Readiness que compruebe PostgreSQL y, cuando corresponda, Redis; liveness no
  dependerá de servicios externos.

No se registran JWT, subprotocolos completos, claves de Maps ni payloads con datos
personales sin redacción.

## Criterios finales de aceptación

- Pasajero y conductor conectados a procesos distintos reciben todos los eventos.
- Matar la API después del commit no pierde la notificación: la outbox la publica.
- Reiniciar workers no evita que una oferta venza ni deja una búsqueda abandonada.
- Redis caído no provoca cancelaciones falsas.
- Duplicar o reordenar eventos no revierte estados terminales en mobile.
- El polling sigue convergiendo y puede mantenerse como respaldo lento.
- La suite PostgreSQL demuestra las carreras críticas.
- Dos workers API superan el smoke test completo de negociación.

## Verificación por etapa

```bash
# Backend
cd backend
.venv/bin/pytest
.venv/bin/ruff check .

# Mobile
cd mobile
npx tsc --noEmit
npm run lint
```

Las fases de Redis/outbox añadirán pruebas de integración y un smoke test que
fuerce a pasajero y conductor a procesos distintos.
