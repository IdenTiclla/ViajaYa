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
`event_id`, `aggregate_id`, `aggregate_version`, `occurred_at`, `type` y `data`.
El cliente aplicará eventos de forma idempotente y descartará versiones anteriores.

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

### Pruebas

- [x] Snapshot seguido de deltas en los e2e WebSocket existentes.
- [ ] Evento duplicado.
- [ ] Evento atrasado con menor `aggregate_version`.
- [ ] Reconexión con snapshot más nuevo que los eventos locales.
- [x] Payload inválido, razón inválida y tipo desconocido en el contrato backend.
- [ ] HTTP que resuelve después de un evento WebSocket.

## Fase 3 — Tiempo real durable y multiworker

### 3.1 Unidad de trabajo y outbox

Para publicar un evento después de un commit sin ventana de pérdida, la mutación
y el registro del evento deben pertenecer a la misma transacción. Se introducirá
una `UnitOfWork` en aplicación de forma incremental; los repositorios harán
`flush` y la unidad de trabajo decidirá `commit`/`rollback`.

Tabla propuesta `realtime_outbox`:

- `id UUID` (`event_id`);
- `event_type`, `topic`;
- `aggregate_type`, `aggregate_id`, `aggregate_version`;
- `payload JSONB`;
- `created_at`, `published_at`;
- `attempts`, `last_error`.

Un dispatcher reclamará filas con `FOR UPDATE SKIP LOCKED`, publicará en Redis y
marcará `published_at`. Si muere después de publicar y antes de marcar, el evento
se repetirá; por eso la idempotencia del cliente es obligatoria.

Las operaciones atómicas de aceptación, cancelación, pausa y creación/reemplazo
de oferta serán las primeras en migrar. No se retirará la publicación directa
hasta que la outbox funcione en modo sombra y sus métricas coincidan.

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
2. Desplegar tablas outbox/acciones sin consumidores.
3. Emitir envelopes versionados y actualizar mobile para idempotencia.
4. Activar dispatcher y worker en modo sombra.
5. Activar Redis bridge con un worker API y comparar eventos/snapshots.
6. Desactivar temporizadores y publicación directa mediante feature flags.
7. Probar reinicios forzados de API, Redis y workers.
8. Habilitar dos workers API en staging; luego producción.

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
