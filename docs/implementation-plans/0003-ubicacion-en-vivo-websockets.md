# 0003 — Ubicación del conductor en vivo (WebSocket) con costo bajo

> **Estado: ⏳ Pendiente.** Depende de la entrega 0002 (flujo de viaje completo, ya implementado:
> ofertas, viaje en curso con mapa, calificación, historial, ganancias).

## Contexto

Hoy el “tiempo real” de ViajaYa es **polling** (React Query `refetchInterval`): el estado del viaje,
las ofertas y el historial se refrescan cada 3–4 s (`useRide`, `useRideOffers`, `useOpenRides`). Las
vistas del viaje en curso (`TripScreen` pasajero, `ViajeEnCursoConductorScreen` conductor) dibujan el
trayecto origen→destino con `TripRouteMap`, pero **no muestran la posición real del conductor**.

Queremos que el pasajero vea al conductor moverse en el mapa **en tiempo real**, mediante **WebSocket**,
sin que los costos se disparen.

**Decisiones de arquitectura (clave para el costo):**
- **Transporte mixto:** WebSocket **solo** para el GPS del conductor (lo único que necesita ser
  instantáneo). El resto (estado del viaje, ofertas, historial, ganancias) **sigue por polling** — más
  simple y ya funciona.
- **Hosting de tarifa plana:** un proceso `uvicorn` siempre encendido (VPS/contenedor fijo). Los
  WebSocket nativos de FastAPI no cuestan por mensaje ni por conexión en este modelo. **Evitar
  serverless por request** para el socket (cobra por conexión‑minuto/mensaje).
- **Último valor en memoria:** no se persiste cada posición en Postgres (solo importa la última). Store
  en memoria del proceso; **Redis pub/sub se difiere** a cuando haya varios procesos (ver §Escalado).
- **Disciplina de Google Maps (el costo real):** la posición cruda viaja gratis por el socket y mueve el
  marcador; la **ruta/ETA se recalcula como máximo cada ~20–30 s** (o ante desvío), no en cada tick.

---

## Flujo objetivo

```
Conductor (viaje activo) --GPS cada ~2–3 s--> WS /ws/rides/{id} --broadcast--> Pasajero (marcador animado)
```

1. Al asignarse el conductor (`ACCEPTED`), ambos abren el socket del viaje.
2. El **conductor** emite su posición (`expo-location` watcher) mientras el viaje esté
   `ACCEPTED/ARRIVING/IN_PROGRESS`.
3. El backend guarda la **última posición** y la **reenvía** a los suscriptores del viaje (el pasajero).
4. El **pasajero** mueve un marcador animado en el mapa; el ETA del banner se recalcula con
   moderación desde la posición del conductor.
5. En `COMPLETED`/`CANCELLED` se cierra el socket y se limpia la posición.

---

## Backend (`backend/`, Clean Architecture)

### 1. Dominio — `app/domain/entities.py`
- Value object `DriverLocation` (`@dataclass(frozen=True)`): `latitude`, `longitude`,
  `heading: float | None`, `updated_at: datetime`.

### 2. Aplicación — puertos y casos de uso
- `app/application/interfaces.py`: puerto `DriverLocationStore`
  - `set(ride_id, location)`, `get(ride_id) -> DriverLocation | None`, `clear(ride_id)`.
- `app/application/use_cases/update_driver_location.py`: valida que `current_user` sea el
  **conductor asignado** del ride y que el estado esté en `{ACCEPTED, ARRIVING, IN_PROGRESS}`
  (reusa `RideRequestRepository.get_by_id` y excepciones `NotAuthorizedActionError`,
  `InvalidRideTransitionError`); guarda en el store y devuelve la `DriverLocation` para difundir.
- (Lectura) reusar `get_ride`/store para obtener el último valor.

### 3. Infraestructura
- `app/infrastructure/realtime/location_store.py`: `InMemoryDriverLocationStore` (dict
  `ride_id -> DriverLocation`, con TTL/limpieza al cerrar el viaje).
- `app/infrastructure/realtime/connection_manager.py`: `RideConnectionManager` que mantiene
  `ride_id -> set[WebSocket]` de **suscriptores** (pasajeros) y expone `connect/disconnect/broadcast`.
  Manejo de desconexión y limpieza de sets vacíos.

### 4. API — endpoint WebSocket
- `app/api/v1/ws/rides.py`: `@router.websocket("/ws/rides/{ride_id}")`.
  - **Auth del socket:** token de acceso por **query param** `?token=<access_token>` (RN no permite
    headers en `WebSocket`); validar con `JwtTokenService.decode_access_token` y cargar el usuario.
    Cerrar con código de política si el token es inválido (`1008`). Usar **`wss://` en producción**
    para que el token viaje cifrado; el access token es de vida corta (mitiga fuga en logs/URL).
  - **Autorización:** el usuario debe ser el `rider_id` o el `driver_id` del ride; si no, cerrar.
  - **Rol conductor:** recibe mensajes JSON `{lat, lng, heading?}`; por cada uno ejecuta
    `update_driver_location` y hace `broadcast` a los suscriptores del viaje.
  - **Rol pasajero:** al conectar, **enviar de inmediato** el último valor (`store.get`) y luego quedar
    suscrito a los broadcasts.
  - Cierre/limpieza al desconectar o al detectar estado terminal.
  - Inyección: reutilizar factories de `deps.py` (token service, repos) creando una sesión por
    conexión; registrar el router en `app/main.py`.
- **Fallback por polling (resiliencia):** añadir `driver_location` (nullable) a `RideResponse`
  (`schemas/rides.py`) leyendo del store en `get_ride`. Así, si el socket se cae, el pasajero sigue
  viendo la última posición vía el polling de `GET /rides/{id}` que ya existe.

### 5. Tests — `backend/tests/`
- `unit/`: `update_driver_location` (rechaza a no‑conductor, rechaza ride no activo, guarda y
  devuelve). `InMemoryDriverLocationStore` (set/get/clear).
- `e2e/`: `TestClient.websocket_connect` (Starlette) — conductor publica, pasajero recibe; token
  inválido cierra; usuario ajeno al viaje cerrado. Verificar `driver_location` en `GET /rides/{id}`.

---

## Mobile (`mobile/`, Expo Router + feature `rides`)

### 1. Configuración — URL del WebSocket
- En `core/config/env.ts`/`app.config.ts`: derivar `wsUrl` de `apiUrl` (`http→ws`, `https→wss`) o
  exponerla aparte. No leer `process.env` directo (regla de `CLAUDE.md`).

### 2. Cliente WS — `core/realtime/`
- `rideSocket.ts`: utilidad que abre `new WebSocket(`${wsUrl}/ws/rides/${id}?token=${accessToken}`)`,
  con **reconexión con backoff**, parseo JSON, y API `send(location)` / `onMessage(cb)` / `close()`.
  Tomar el token de `core/http/tokenStorage`.

### 3. Conductor — emitir GPS
- Hook `features/rides/application/useReportLocation.ts`: con `expo-location`
  `watchPositionAsync({ accuracy: High, distanceInterval: 30, timeInterval: 3000 })` **solo** cuando
  el viaje está activo; envía cada lectura por el socket. Permisos ya declarados en `app.config.ts`.
  Iniciar/detener según `ride.status` en `ViajeEnCursoConductorScreen`. (Background con
  `expo-task-manager` queda **fuera de alcance**; MVP en foreground.)

### 4. Pasajero — consumir y pintar
- Hook `features/rides/application/useDriverLocation.ts`: se suscribe al socket del viaje y expone la
  última `{lat,lng,heading}`; **fallback** a `ride.driverLocation` (del polling) cuando el socket esté
  caído.
- `TripRouteMap`: añadir un **marcador animado del conductor** (`MarkerAnimated` + `AnimatedRegion`
  interpolando ~1 s entre posiciones, `rotation={heading}`, ícono de auto/moto). Incluirlo en el
  `fitToCoordinates` junto al punto relevante (origen si `accepted/arriving`, destino si `in_progress`).
- **ETA con disciplina de costo:** recalcular la ruta desde la posición del conductor con
  `routesService`/`useRoute` **a lo sumo cada 20–30 s** (throttle) o ante desvío; entre tanto, solo
  mover el marcador (gratis). Mostrar el ETA en el banner de navegación.

### 5. Contrato en sintonía
- `Ride.driverLocation` en `features/rides/domain/types.ts` + mapper en `data/ridesRepository.ts`.

---

## Control de costos (resumen operativo)

- **Cómputo plano:** un `uvicorn` siempre encendido (~5–12 USD/mes); el socket no añade costo por
  mensaje. No usar serverless por request para el WS.
- **Solo durante viaje activo:** abrir socket al `ACCEPTED`, cerrarlo en `COMPLETED`/`CANCELLED`.
- **Frecuencia moderada:** GPS cada 2–3 s o cada 30 m; interpolar en el cliente para que se vea fluido.
- **Maps acotado:** NO recalcular ruta/ETA por tick → cada 20–30 s o ante desvío. Es el mayor ahorro.
- **Último valor en memoria** (sin escribir cada posición en BD).

---

## Escalado (cuándo y qué pagar más)

1. **Ahora:** 1 proceso FastAPI + store/manager en memoria. Costo = el VPS, plano.
2. **Varios procesos/instancias:** añadir **Redis pub/sub** (Redis chico ~5–10 USD/mes) para que el
   broadcast llegue al proceso donde está el socket del pasajero; el manager publica/escucha en Redis.
3. **No operar infra:** servicios gestionados (Ably/Pusher/Supabase Realtime) con capa gratis; cómodos
   pero su costo crece por conexiones/mensajes. Posponer hasta que el volumen lo justifique.

---

## Orden de implementación

1. Backend: `DriverLocation` + `DriverLocationStore` (memoria) + `update_driver_location` +
   `RideConnectionManager` + endpoint `ws` + `driver_location` en `RideResponse`. Tests unit/e2e.
2. Mobile: `wsUrl` en config + cliente `rideSocket` (reconexión).
3. Mobile conductor: `useReportLocation` (expo-location → socket), cableado en el viaje en curso.
4. Mobile pasajero: `useDriverLocation` + marcador animado en `TripRouteMap` + ETA throttled.
5. Calidad (`ruff`/`pytest`; `tsc`/`lint`) y prueba con dos dispositivos.

---

## Verificación (end-to-end)

- **Dos sesiones** (pasajero + conductor) en un viaje activo: el marcador del conductor se mueve suave
  en el mapa del pasajero; el banner de ETA se actualiza con moderación.
- **Resiliencia:** cortar la red del pasajero → al reconectar el socket retoma; con socket caído, la
  última posición sigue visible vía el polling de `GET /rides/{id}` (`driver_location`).
- **Autorización:** un usuario ajeno al viaje no puede conectarse; token inválido cierra el socket.
- **Costo:** contar las llamadas a Google Routes en un viaje de prueba y confirmar que el ETA se
  recalcula cada ~20–30 s (no por cada posición).

---

## Riesgos / decisiones abiertas

- **Token en la URL del WS:** aceptable con `wss://` (cifrado) y access token de vida corta; evitar
  loguear la query. Alternativa futura: handshake de auth como primer mensaje del socket.
- **Background location:** fuera de alcance (MVP solo foreground); si se requiere, `expo-task-manager`.
- **Un solo proceso:** el store/manager en memoria asume 1 worker; al escalar, Redis pub/sub (§Escalado).
- **Batería/datos del dispositivo:** mitigado con frecuencia adaptativa y socket solo en viaje activo.
