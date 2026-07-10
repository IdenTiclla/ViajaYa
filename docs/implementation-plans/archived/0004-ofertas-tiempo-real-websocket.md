# 0004 — Negociación de ofertas en tiempo real (WebSocket) + despacho atómico

> **Estado: ⏳ Pendiente.** Sustituye el polling del flujo de ofertas (entrega 0002, ya
> implementada) por **WebSocket** y añade el **despacho atómico** ("el primero que acepta, gana")
> para que un conductor pueda ofertar a varios pasajeros en paralelo sin asignaciones dobles.
>
> Comparte infraestructura realtime con el plan **0003** (ubicación en vivo): ambos usan
> `app/infrastructure/realtime/` y el helper de auth del socket. **Si 0004 se implementa antes que
> 0003, deja la base WS lista**; si 0003 ya existe, reutilízala (no dupliques `connection_manager`).

## Contexto

Hoy la negociación es **polling** (React Query `refetchInterval` 3–4 s): `useRideOffers` (pasajero),
`useOpenRides` y `useDriverActiveRide` (conductor), `useRide` (ambos). Funciona, pero con retraso de
1–4 s, consultas `SELECT` repetidas que casi siempre devuelven lo mismo, y batería/datos del móvil.

Queremos el modelo de **subasta abierta en vivo** del documento de arquitectura:

- El pasajero ve las ofertas **aparecer al instante** conforme los conductores ofertan.
- El conductor ve las **solicitudes nuevas al instante** y puede ofertar a **varios pasajeros a la vez**.
- **Regla de oro:** el primer pasajero que pulse **Aceptar** se queda al conductor; cualquier segundo
  intento sobre ese conductor recibe un error controlado (409) y la app **retira la tarjeta**.
- Al aceptar, las **demás ofertas vivas de ese conductor** (en otras solicitudes) se retiran solas y
  esos pasajeros lo ven desaparecer de su pantalla en tiempo real.

**Estado real del código (verificado 2026-06-02):**
- **No existe** infraestructura WS: no hay `app/infrastructure/realtime/`, ni router `ws`, ni nada
  registrado en `app/main.py` (solo `auth`, `rides`, `drivers`, `saved_places`).
- `accept_offer.py` valida (rider dueño, ride `SEARCHING`, oferta `PENDING` y vigente 30 s), marca la
  oferta `ACCEPTED`, **rechaza el resto del mismo ride** (`reject_others`), asigna `driver_id` y pasa
  el ride a `ACCEPTED`. **NO** comprueba que el conductor siga libre, **NO** retira las ofertas del
  conductor en **otras** solicitudes, y **NO** usa bloqueo de fila → posible doble asignación si dos
  pasajeros aceptan al mismo conductor a la vez.
- `OfferRepository` tiene `add/get_by_id/update/list_by_ride/reject_others/reject_pending`. Cada método
  hace su propio `commit()` (sin unidad de trabajo transaccional multi-paso).
- Disponibilidad del conductor: **no hay columna "ocupado"**; se infiere de tener un viaje activo
  (`get_driver_active_ride` mira `ACCEPTED/ARRIVING/IN_PROGRESS`). Mantendremos ese criterio.
- Dos TTLs (memoria [[oferta-expiry-model]]): **solicitud 60 s**, **oferta 30 s**. El conteo y la
  expiración se resuelven **en el cliente** (`useCountdown`, `OfferLifeTimer`) y el backend filtra
  vencidos al leer. **Esto se conserva**: el WS empuja eventos discretos (crear/aceptar/retirar/estado),
  no la expiración.
- Auth móvil: JWT Bearer vía `core/http/client.ts`; token en `core/http/tokenStorage` (SecureStore).
- Backend con `uv`/Python 3.12; DB Postgres en `docker compose`; tests con SQLite (ver §Riesgos).

**Decisiones de arquitectura:**
- **Transporte mixto.** WS para los **eventos de la negociación** (ofertas y solicitudes que aparecen/
  desaparecen, oferta aceptada, conductor retirado). El **estado del viaje en curso** y el historial
  siguen por polling (ya funcionan; 0003 añade el GPS por WS aparte).
- **Eventos discretos, no estado.** El socket transmite *qué cambió* (`offer_created`, `offer_withdrawn`,
  `ride_created`, `ride_closed`, `offer_accepted`, `ride_status`). El cliente aplica el cambio sobre la
  caché de React Query; **no** rehacemos la pantalla con cada mensaje.
- **Polling como red de seguridad.** Se mantiene un `refetchInterval` lento (~15–20 s) como respaldo
  si el socket se cae; con socket vivo, el refresco rápido se desactiva.
- **Despacho atómico en BD.** La aceptación se vuelve una **transacción con bloqueo de fila**
  (`SELECT … FOR UPDATE` en Postgres) que re-verifica que el conductor sigue libre antes de asignar.
- **Un proceso, store en memoria.** El hub de conexiones vive en memoria del proceso `uvicorn`. Redis
  pub/sub se difiere a multi-proceso (igual que 0003, ver §Escalado).

---

## Flujo objetivo

```
Pasajero publica solicitud ─POST /rides─▶ backend ─WS broadcast 'ride_created'─▶ conductores online (pool del servicio)
Conductor oferta ───────────POST /rides/{id}/offers─▶ backend ─WS 'offer_created'─▶ pasajero (tarjeta nueva)
Pasajero acepta ────────────POST /rides/offers/{id}/accept─▶ TX atómica:
   ├─ éxito ─▶ 'ride_status: accepted' al pasajero  +  'offer_accepted' al conductor (→ navegación)
   │          +  'offers_withdrawn' al conductor     +  'offer_withdrawn' a los OTROS pasajeros del conductor
   │          +  'ride_closed' al pool (la solicitud sale de las listas)
   └─ conflicto (conductor ya tomado) ─▶ HTTP 409 ─▶ la app retira esa tarjeta
```

Suscripciones (topics) que mantiene el hub en memoria:
- `ride:{ride_id}` — el **pasajero** dueño del ride (recibe ofertas y cambios de su viaje).
- `pool:{service_type}` — conductores **online** de ese `vehicle_type` (taxi/moto) → solicitudes nuevas.
- `driver:{driver_id}` — el **conductor** (recibe "fuiste elegido" y "se retiraron tus otras ofertas").

---

## Backend (`backend/`, Clean Architecture)

### 1. Infraestructura realtime — `app/infrastructure/realtime/` (nuevo, compartido con 0003)
- [ ] `connection_manager.py`: `RealtimeHub` con `topic -> set[WebSocket]`.
  - `subscribe(topic, ws)` / `unsubscribe(topic, ws)` / `unsubscribe_all(ws)`.
  - `async broadcast(topic, message: dict)` — serializa JSON y envía a cada socket; descarta y limpia
    los que fallan; elimina sets vacíos. Tolerante a desconexión.
  - **Singleton de módulo** (`hub = RealtimeHub()`) — vive en el proceso `uvicorn`.
- [ ] `ws_auth.py`: `authenticate_ws(token, users, tokens) -> User | None` — valida el access token
  (`JwtTokenService.decode_access_token`), carga el usuario; `None` si inválido. (Reutilizable por 0003.)
- [ ] Envelope de mensaje uniforme: `{ "type": "<evento>", "data": { … } }`.

### 2. Aplicación — puerto de publicación de eventos
Para no acoplar los casos de uso al transporte, definimos un **puerto** y publicamos **en la capa API**
(routers) tras el éxito del caso de uso, usando los DTOs que ya devuelven. (Alternativa: inyectar el
puerto en los casos de uso; se descarta para mantener dominio/uso libres de transporte.)
- [ ] `app/application/interfaces.py`: puerto `RideEventPublisher` con métodos de alto nivel:
  `ride_created(ride)`, `ride_closed(ride_id, reason)`, `offer_created(ride_id, offer_detail)`,
  `offer_withdrawn(ride_id, offer_id)`, `offer_accepted(driver_id, ride_detail)`,
  `offers_withdrawn(driver_id, ride_ids)`, `ride_status(ride)`.
- [ ] Implementación `app/infrastructure/realtime/event_publisher.py`: `HubRideEventPublisher` que
  traduce cada método a `hub.broadcast(topic, {type, data})` con los topics de arriba. Serializa con
  los **mismos schemas Pydantic** de la API (`OfferResponse`, `RideResponse`, `OpenRideResponse`) para
  que el cliente reciba exactamente lo que ya entiende.

### 3. Despacho atómico — el cambio central
- [ ] `app/domain/exceptions.py`: nueva `DriverUnavailableError(DomainError)` ("El conductor ya aceptó
  otro servicio").
- [ ] `app/domain/repositories.py` — métodos nuevos:
  - `OfferRepository.list_pending_by_driver(driver_id) -> list[Offer]` (para saber a qué otros rides
    avisar y retirar).
  - `OfferRepository.reject_by_driver(driver_id, keep_offer_id)` (rechaza las demás `PENDING` del
    conductor en cualquier ride).
  - `RideRequestRepository.get_active_for_driver(driver_id) -> RideRequest | None` (estado en
    `{ACCEPTED, ARRIVING, IN_PROGRESS}`) — el criterio de "ocupado".
- [ ] **Operación atómica en el repo** `OfferRepository.accept_atomically(offer_id, rider_id) ->
  AcceptResult` — **una sola transacción** (un `commit`):
  1. `SELECT … FOR UPDATE` de la oferta y del conductor (bloqueo de fila en Postgres).
  2. Re-verifica dentro del lock: oferta `PENDING` y vigente, ride `SEARCHING`, **y el conductor sin
     viaje activo** (`get_active_for_driver is None`). Si está ocupado → `DriverUnavailableError`.
  3. Oferta elegida → `ACCEPTED`; `reject_others(ride_id, keep)`; `reject_by_driver(driver_id, keep)`
     (captura antes los `ride_id` afectados para difundir el retiro); ride → `ACCEPTED` con `driver_id`/
     `accepted_offer_id`.
  4. Devuelve `AcceptResult { ride, driver, accepted_offer, withdrawn_ride_ids: list[UUID] }`.
  > La validación previa del caso de uso evita trabajo inútil; la **re-verificación dentro del lock**
  > es la que garantiza la regla de oro (cierra la ventana TOCTOU).
- [ ] `accept_offer.py`: mantiene las validaciones de autorización/propiedad y delega el commit en
  `accept_atomically`; devuelve un DTO ampliado con `withdrawn_ride_ids` para que el router difunda.

### 4. API — endpoint WebSocket y publicación de eventos
- [ ] `app/api/v1/ws/negotiation.py` (nuevo): un socket por rol/topic. Auth por **query param**
  `?token=<access_token>` (RN no permite headers en `WebSocket`); validar con `authenticate_ws`;
  cerrar `1008` si inválido. Crear **una sesión por conexión** (reusar `get_session`).
  - **Pasajero** `@router.websocket("/ws/rides/{ride_id}")`: autoriza que sea el `rider_id` del ride;
    suscribe a `ride:{ride_id}` y a `driver:`(N/A); al conectar envía snapshot inicial (las ofertas
    vigentes actuales) y queda suscrito. Limpieza al desconectar / estado terminal.
  - **Conductor** `@router.websocket("/ws/driver")`: autoriza rol conductor; suscribe a
    `pool:{vehicle_type}` y `driver:{driver_id}`; al conectar envía las solicitudes abiertas actuales.
    (Solo conectar cuando está **online**.)
  - Mensajes entrantes del cliente: no son necesarios para la negociación (las acciones siguen siendo
    HTTP POST). El socket es **solo de bajada** para estos topics → cualquier mensaje entrante se
    ignora salvo un `ping` opcional. (En 0003 el conductor sí emite GPS por su propio socket.)
- [ ] Registrar el router WS en `app/main.py` (`include_router(..., prefix="/api/v1")`).
- [ ] **Publicar eventos desde los routers HTTP existentes** (`routers/rides.py`, `routers/drivers.py`),
  tras el caso de uso, vía `RideEventPublisher` (inyectado en `deps.py` como singleton del hub):
  - `POST /rides` (crear solicitud, en su router actual) → `ride_created` al `pool:{service_type}`.
  - `POST /rides/{id}/offers` → `offer_created` a `ride:{id}`.
  - `POST /rides/offers/{id}/accept` → `ride_status(accepted)` a `ride:{id}`; `offer_accepted` a
    `driver:{driver_id}`; `offers_withdrawn` a `driver:{driver_id}`; `offer_withdrawn` a cada
    `ride:{withdrawn_ride_id}`; `ride_closed` al `pool`.
  - `PATCH /rides/{id}/status` y `POST /rides/{id}/cancel` → `ride_status` a `ride:{id}`; si pasa a
    terminal, `ride_closed` al pool y limpieza.
  - `POST /rides/{id}/keep-searching` → opcional `ride_created`/refresh al pool (sigue visible).
- [ ] `api/deps.py`: factory `get_event_publisher` que devuelve `HubRideEventPublisher(hub)` (singleton);
  `Annotated` para inyectarlo en los routers. `api/errors.py`: `DriverUnavailableError` → **409**.

### 5. Tests — `backend/tests/`
- [ ] `unit/test_accept_atomically.py`: la regla de oro — dos aceptaciones del mismo conductor, la
  segunda lanza `DriverUnavailableError`; `reject_by_driver` retira las otras `PENDING` y devuelve sus
  `ride_id`; conductor ya con viaje activo → rechazo. Usa `tests/fakes.py` (extender el fake de ofertas
  con `accept_atomically`, `list_pending_by_driver`, `reject_by_driver`).
- [ ] `e2e/test_negotiation_ws.py`: `TestClient.websocket_connect` (Starlette) —
  - pasajero conectado a ` /ws/rides/{id}` recibe `offer_created` cuando un conductor oferta por HTTP;
  - dos pasajeros con ofertas del mismo conductor: uno acepta (200) → el otro recibe `offer_withdrawn`
    y su POST accept devuelve 409;
  - el conductor en `/ws/driver` recibe `ride_created` al publicarse una solicitud de su tipo y
    `offer_accepted` al ser elegido; token inválido cierra; usuario ajeno al ride es rechazado.
- [ ] Conservar verde `e2e/test_offers_flow_api.py` (el flujo HTTP no cambia de contrato).

---

## Mobile (`mobile/`, Expo Router + feature `rides`)

### 1. Configuración — URL del WebSocket
- [ ] En `core/config/env.ts` / `app.config.ts`: derivar `wsUrl` de `apiUrl` (`http→ws`, `https→wss`).
  No leer `process.env` en runtime (regla de `CLAUDE.md`). (Lo comparte 0003.)

### 2. Cliente WS — `core/realtime/` (nuevo, compartido con 0003)
- [ ] `socket.ts`: utilidad genérica `openSocket(path)` que abre
  `new WebSocket(`${wsUrl}${path}?token=${accessToken}`)` (token de `core/http/tokenStorage`), con
  **reconexión con backoff**, parseo del envelope `{type, data}`, y API `onMessage(cb)` / `close()`.
  Maneja `AppState` para reconectar al volver a foreground.

### 3. Puente WS → React Query (clave para no reescribir pantallas)
- [ ] `features/rides/application/useNegotiationSocket.ts` (pasajero) y
  `useDriverPoolSocket.ts` (conductor): abren el socket adecuado y, por cada evento, **mutan la caché**
  de React Query con `queryClient.setQueryData` / `invalidateQueries`:
  - Pasajero (`ride:{id}`): `offer_created` → añade a `['ride-offers', rideId]`; `offer_withdrawn` →
    la quita; `ride_status` → actualiza `['ride', rideId]` (y navega a viaje al `accepted`).
  - Conductor (`pool` + `driver`): `ride_created` → añade a `['open-rides']`; `ride_closed` → la quita;
    `offer_accepted` → set `['driver-active-ride']` y navega a la pantalla de viaje; `offers_withdrawn`
    → limpia el estado `offered`/tarjetas en `useDriverRequests`.
- [ ] **Polling como respaldo:** en `useRides.ts`, bajar los `refetchInterval` rápidos a ~15–20 s
  (o `false` mientras el socket esté conectado, vía un flag del hook). Las pantallas siguen leyendo de
  React Query sin cambios estructurales.

### 4. UX pasajero — `features/booking/presentation/OffersScreen.tsx`
- [ ] Las tarjetas de oferta **aparecen/desaparecen en vivo** (vienen del puente WS). Mantener los
  contadores locales 30 s por tarjeta (`OfferLifeTimer`) y el de 60 s en cabecera (se oculta si hay
  ofertas) — sin cambios en la lógica de expiración.
- [ ] **Aceptar con manejo de 409:** al pulsar Aceptar, si el backend responde **409**
  (`DriverUnavailableError`), retirar esa tarjeta y mostrar un aviso ("Ese conductor ya tomó otro
  viaje"); el resto de ofertas siguen disponibles. Al **200**, navegar al viaje en curso.
- [ ] Estado de conexión sutil (p. ej. "Conectando…" si el socket está reconectando) sin bloquear la UI.

### 5. UX conductor — `features/driver/presentation/SolicitudesEntrantesScreen.tsx`
- [ ] Suscribir el socket **solo cuando está online**; las solicitudes entran/salen en vivo (lista y
  `SolicitudesMapa`). Reusar `useDriverRequests` (dismissed/offered) tal cual.
- [ ] **Ofertas en paralelo:** el conductor puede ofertar a varias solicitudes a la vez (ya lo permite
  el backend; el estado `offered` es por `rideId`). Botones rápidos de incremento sobre la tarifa base
  (`+Bs.`) en `CounterOfferModal` (UX segura, sin teclado) — opcional, recomendado por el documento.
- [ ] **Ser elegido:** al recibir `offer_accepted`, navegar directo a `ViajeEnCursoConductorScreen`
  (no esperar al polling de `useDriverActiveRide`). Al recibir `offers_withdrawn`, sus otras tarjetas
  "esperando al pasajero" (`OfertaEnviadaScreen`) muestran que la oferta ya no aplica.

### 6. Contrato en sintonía
- [ ] Tipos de los eventos WS en `features/rides/domain/types.ts` (envelope + payloads, reutilizando
  `Offer`/`Ride`/`OpenRide` existentes). Mappers en `data/` si el payload difiere del DTO HTTP.

---

## Orden de implementación

1. **Backend infra:** `RealtimeHub` + `ws_auth` + puerto `RideEventPublisher` y `HubRideEventPublisher`.
2. **Backend atómico:** `DriverUnavailableError`, métodos de repo (`accept_atomically`,
   `list_pending_by_driver`, `reject_by_driver`, `get_active_for_driver`), refactor de `accept_offer`.
   Tests unit del despacho atómico.
3. **Backend WS:** router `ws/negotiation.py` + registro en `main.py` + publicación de eventos en los
   routers HTTP + factory en `deps.py` + 409 en `errors.py`. Tests e2e WS.
4. **Mobile infra:** `wsUrl` + cliente `core/realtime/socket.ts`.
5. **Mobile puente:** `useNegotiationSocket` / `useDriverPoolSocket` (WS → caché) y bajar el polling a
   respaldo.
6. **Mobile UX:** `OffersScreen` (live + 409) y `SolicitudesEntrantesScreen` (online + elegido).
7. Calidad (`ruff`/`pytest`; `tsc`/`lint`) y prueba con dos sesiones.

---

## Limpieza y residuos (qué se retira, repurpone o conserva)

> El cambio a WS no es solo añadir: hay que **evitar dejar dos fuentes de verdad** (polling rápido +
> socket) corriendo a la vez, lo que duplicaría carga/coste y causaría parpadeo de la caché.

**Se repurpone (no se borra):**
- [ ] `mobile/.../useRides.ts`: los `refetchInterval` rápidos (`POLL_OFFERS_MS=3000`,
  `POLL_RIDE_MS=3000`, `POLL_OPEN_MS=4000`, `POLL_ACTIVE_MS=4000`) pasan a **respaldo lento** (~15–20 s)
  o `false` mientras el socket esté conectado. **No** dejar el polling rápido y el socket activos a la
  vez. Renombrar/comentar los constantes para que quede claro que ahora son *fallback*.

**Se retira si quedó como residuo (verificar antes de borrar):**
- [ ] Restos de intentos previos de **heartbeat / AppState** para la vida de la oferta: la memoria del
  proyecto indica que ese enfoque fue **descartado**; confirmar que no quedó código muerto
  (listeners de `AppState`, timers de "sigo vivo") y eliminarlo si aparece. **No reintroducirlo.**
- [ ] Imports, constantes o helpers que queden **sin uso** tras bajar el polling (p. ej. si algún hook
  deja de necesitar `refetchInterval`). Pasar `tsc`/`lint` para detectarlos.

**Se conserva (NO es residuo, aunque lo parezca):**
- [ ] `OfferRepository.reject_others` y `reject_pending`, los contadores locales `useCountdown` /
  `OfferLifeTimer`, y el filtrado de vencidos del backend: la **expiración sigue en el cliente** y el
  backend sigue filtrando al leer ([[oferta-expiry-model]]). El WS no sustituye esto.
- [ ] El flujo HTTP de ofertas (los `POST`/`PATCH` actuales): **no cambia de contrato**; el WS solo
  añade el canal de eventos. `e2e/test_offers_flow_api.py` debe seguir verde.

**No duplicar:**
- [ ] Si el plan **0003** ya creó `app/infrastructure/realtime/` (hub/auth) o `core/realtime/` en mobile,
  **extender** esos módulos en vez de crear copias. Un solo hub sirve a negociación y GPS.

---

## Verificación (end-to-end)

**Backend**
```bash
cd backend && source .venv/bin/activate
docker compose up -d db            # desde la raíz
alembic upgrade head
ruff check . && pytest             # unit (atómico) + e2e (HTTP + WS)
uvicorn app.main:app --reload --port 8000
```
Regla de oro (Swagger + dos clientes WS): un conductor oferta a dos pasajeros; el primero que acepta
recibe 200; el segundo recibe `offer_withdrawn` por WS y 409 al intentar aceptar.

**Mobile**
```bash
cd mobile && npx tsc --noEmit && npm run lint && npx expo start -c
```
Tres sesiones: 2 pasajeros + 1 conductor. El conductor (online) ve ambas solicitudes en vivo y oferta a
las dos; cada pasajero ve la oferta aparecer al instante; el primero que acepta arranca el viaje y al
segundo le **desaparece** el conductor de la pantalla.

---

## Riesgos / decisiones abiertas

- **`SELECT … FOR UPDATE` en SQLite (tests):** los locks de fila son *no-op* en SQLite; la atomicidad
  real se valida en Postgres. En tests, la transacción de un solo hilo basta para cubrir la lógica;
  documentar que la garantía de concurrencia es de Postgres. (Alternativa: lock optimista con una
  cláusula `WHERE status='searching'` en el `UPDATE` y verificar `rowcount` — funciona en ambos.)
  **Recomendado:** combinar `FOR UPDATE` (Postgres) **y** el `UPDATE … WHERE` condicional como guarda
  portable.
- **Token en la URL del WS:** aceptable con `wss://` (cifrado) y access token de vida corta; no loguear
  la query. Igual que 0003.
- **Un solo proceso:** hub en memoria asume 1 worker `uvicorn`. Multi-proceso → Redis pub/sub (§Escalado
  de 0003). El `RideEventPublisher` quedaría detrás del mismo puerto, cambiando solo la implementación.
- **Expiración sigue en el cliente:** el WS no empuja expiración (no hay tarea de fondo); los contadores
  locales 60 s/30 s y el filtrado del backend al leer se conservan. No reintroducir lógica de AppState
  para la vida de la oferta ([[oferta-expiry-model]]).
- **Snapshot inicial al conectar:** evita una ventana ciega entre el `GET` inicial y el primer evento;
  el socket envía el estado actual (ofertas/solicitudes vigentes) justo al suscribir.
- **Coexistencia con 0003:** si 0003 ya añadió `app/infrastructure/realtime/`, **extender** ese
  `connection_manager`/auth en vez de duplicarlos; los dos sockets (negociación y GPS) comparten hub.
```
