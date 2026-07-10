# Plan 0007 — Cancelar la búsqueda cuando el pasajero desaparece

> **Actualización 2026-07-10:** la validación en un Android físico mostró que 30 s
> confunde una reconexión móvil con abandono y puede cancelar justo cuando llega una
> contraoferta. La gracia efectiva vuelve a **120 s** y `GET /rides/me/active` la
> renueva: la búsqueda solo se cancela si desaparecen tanto WebSocket como polling.

> **Contexto:** hoy, cuando el pasajero crea una solicitud (`SEARCHING`) y **mata la app**, la
> solicitud sigue viva: durante la ventana de gracia (120 s) los conductores la ven y pueden
> ofrecer, y al vencer la gracia solo se **oculta** del pool — el `RideRequest` queda
> `SEARCHING` en la BD para siempre (lo dice el docstring de `app/api/v1/presence.py:10-14`).
> Síntoma reportado: conductores ofreciendo sobre una solicitud cuyo pasajero ya no está. Este
> plan cambia el vencimiento de la gracia de "ocultar" a **cancelar de verdad**, en backend y
> sin servicio de ubicación en segundo plano. **Creado:** 2026-07-05.

## Decisiones de diseño (acordadas con el usuario)

- **Solo backend.** No instalamos `expo-task-manager` ni servicio de ubicación en segundo
  plano: el foreground-service **no** resuelve "mató la app" (cuando el proceso muere, el
  servicio también muere), pesa en batería/permisos y `ACCESS_BACKGROUND_LOCATION` recibe
  scrutiny del Play Store. La cancelación la dispara el backend sobre el `onclose` del WS del
  pasajero.
- **Gracia 120 s + heartbeat HTTP.** Toleramos reconexiones reales de Android; cada
  `GET /rides/me/active` exitoso renueva la ventana si solo cayó el WebSocket.
- **Sin toast.** El flujo mobile existente ya navega al home en silencio al detectar
  `cancelled` (`OffersScreen.tsx:116-120`), vía WS al reconectar o vía polling de 15 s.

## Approach

Reusar la maquinaria existente. El hook de desconexión, el patrón de timer diferido y el UC
de cancelación **ya existen**; solo falta cableear que, al vencer la gracia, se cancele el
`RideRequest` (hoy solo se oculta).

- Hook de desconexión: `presence.on_passenger_disconnect(ride_id, session_factory)` — llamado en
  `app/api/v1/ws/negotiation.py:105` (bloque `finally` de `passenger_ws`).
- Patrón de timer fire-and-forget: `_expire_offer_after` + `_EXPIRY_TASKS` en
  `app/api/v1/routers/rides.py:86-108` — se replica exacto.
- Eventos de cancelación: `publish_ride_status` + `publish_ride_closed` +
  `publish_offer_rejected(reason="ride_cancelled")`, ya publicados por el router de cancel
  manual en `rides.py:322-329` — se reproducen iguales.

**Alcance de la cancelación automática: solo `SEARCHING`.** Si la solicitud ya fue aceptada
(`ACCEPTED`/`ARRIVING`), el auto-cancel **no** actúa: hay un conductor asignado en camino y la
desconexión del pasajero pertenece a otro flujo (la `TripScreen`, no este fix). Esto deja
fuera el riesgo de "tirar abajo un viaje ya asignado".

## Cambios (todos en `backend/`)

### 1. Repository — método atómico `cancel_if_searching`

`app/domain/repositories.py`: añadir al interface `RideRequestRepository`

```python
async def cancel_if_searching(self, ride_id: uuid.UUID) -> RideRequest | None: ...
```

`app/infrastructure/db/repositories.py`: implementar **espejando `accept_atomically`**
(`repositories.py:459-495`): `SELECT … FOR UPDATE` sobre la fila del ride, re-chequear
`status is RideStatus.SEARCHING`, pasar a `CANCELLED`, commit, refresh; devolver el ride
actualizado o `None` si ya no era `SEARCHING`.

> **Por qué atómico:** serializa contra `accept_atomically` (ambos lockean la misma fila del
> ride). Si un `accept` y el auto-cancel compiten, el que pierde el lock ve el estado nuevo y
> aborta — un conductor que acaba de aceptar nunca ve su viaje yanqueado.

### 2. UC — `CancelRideOnDisconnect`

Nuevo `app/application/use_cases/cancel_ride_on_disconnect.py`. No reusar `CancelRide`
porque (a) no hay `user` actor que autorizar y (b) debe ser `SEARCHING`-only:

```python
class CancelRideOnDisconnect:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None: ...

    async def execute(self, ride_id: uuid.UUID) -> CancelRideResult | None:
        updated = await self._rides.cancel_if_searching(ride_id)
        if updated is None:
            return None                      # aceptada/cancelada mientras tanto → no tocar
        cancelled = [o for o in await self._offers.list_by_ride(ride_id)
                     if o.status is OfferStatus.PENDING and not is_offer_expired(o)]
        await self._offers.reject_pending(ride_id)
        return CancelRideResult(ride=updated, cancelled_offers=cancelled)
```

Reutiliza `CancelRideResult` (`app/application/dto.py:144-149`). No publica eventos (como
todo UC); eso lo hace el orchestrador en `presence.py`.

### 3. `presence.py` — gracia 120 s, heartbeat + timer de cancelación

`app/api/v1/presence.py`:

- Mantener `PRESENCE_GRACE_SECONDS = 120.0` y renovar el timer desde el endpoint activo.
- Añadir `_pending_cancels: dict[uuid.UUID, asyncio.Task[None]]` y el set anti-GC
  `_CANCEL_TASKS: set[asyncio.Task[None]] = set()` (espejo de `_EXPIRY_TASKS`).
- `on_passenger_disconnect(ride_id, session_factory)`: tras setear `_last_seen`, agenda el
  cierre diferido; la transacción final revalida estado y pausa.
- `on_passenger_connect(ride_id, session_factory)`: además de `_last_seen.pop(...)`, cancelar y descartar la
  task pendiente de ese ride (reconectó a tiempo → no cancelar).
- Nueva corrutina `_cancel_after_grace(ride_id)` (espejo de `_expire_offer_after`):
  `await asyncio.sleep(PRESENCE_GRACE_SECONDS)` → abre sesión nueva con
  `async_session_factory()` (import de `app.infrastructure.db.session`, lazy para evitar
  imports circulares) → instancia `SqlAlchemyRideRequestRepository`,
  `SqlAlchemyOfferRepository`, `CancelRideOnDisconnect` y ejecuta → si devuelve resultado,
  publica los **mismos 3 eventos** que el cancel manual (`publish_ride_status` +
  `publish_ride_closed` + `publish_offer_rejected(reason="ride_cancelled")` por cada oferta
  viva). Construir el `detail` que exige `publish_ride_status` re-fetchando con
  `rides.open_ride_with_rider(ride_id)` como hace `passenger_ws:88`. Best-effort: envolver en
  `try/except Exception: pass` (es UX en vivo, no crítico); re-raise de `CancelledError`.

`negotiation.py` **no se toca**: ya llama a `presence.on_passenger_disconnect(ride)` en el
`finally` de `passenger_ws:105`.

### 4. Tests

`backend/tests/e2e/test_negotiation_ws.py` — extender el bloque de presencia (junto a los
`test_open_ride_*_after_disconnect` actuales, líneas 332-388):

- `test_ride_cancelled_after_grace_when_passenger_gone`: pasajero se desconecta,
  `monkeypatch` de `PRESENCE_GRACE_SECONDS` a ~0, asertar que el ride pasa a `cancelled` en
  BD y que un conductor conectado recibe `ride_closed` (pool) y `offer_rejected` con
  `reason:"ride_cancelled"` (personal).
- `test_ride_not_cancelled_if_passenger_reconnects_within_grace`: desconecta → reconecta
  dentro de la gracia → el ride sigue `searching` y visible.
- `test_auto_cancel_does_not_touch_accepted_ride`: la oferta se acepta antes de que venza la
  gracia → el auto-cancel no la toca (ride queda `accepted`, sin `ride_closed`).
- Ajustar/extendir `test_open_ride_hidden_after_grace_when_passenger_gone` para asertar
  además el estado `cancelled` en BD (antes solo chequeaba visibilidad).

## Edge cases y limitaciones

- **Reconnect en el límite:** árbitra el `cancel_if_searching` atómico. Si el pasajero
  reconecta un instante antes, `on_passenger_connect` cancela la task. Si un instante
  después, la task ya corrío; el pasajero reconecta a un ride `cancelled` y el polling de 15 s
  lo manda al home.
- **Restart del server mid-gracia:** la task fire-and-forget se pierde. Es la misma
  limitación que `_expire_offer_after` (su mitigación es la recuperación al reconectar el
  conductor). Para el auto-cancel no empeora nada respecto de hoy: el ride queda oculto del
  pool tras la gracia y, si el pasajero nunca vuelve, es un zombie silencioso en BD (como
  hoy). No se resuelve en este fix (out of scope).
- **Cancel manual concurrente:** si el pasajero cancela a mano dentro de la gracia, el
  auto-cancel posterior llama `cancel_if_searching` → devuelve `None` (ya `CANCELLED`) → no
  publica duplicados.

## Rama y commits

- Rama: `fix/cancela-busqueda-pasajero-ausente` (desde `main`).
- Commits en español, Conventional Commits, sin co-author trailer (memoria
  `no-coauthor-trailer`). P. ej.:
  - `feat(presence): cancela la búsqueda al expirar la gracia de desconexión`
  - `test(negotiation): cubre auto-cancel por desconexión y su carrera con accept`

## Verificación

1. **Tests:** `cd backend && source .venv/bin/activate && pytest tests/e2e/test_negotiation_ws.py -q` (verde, incluidos los tests nuevos). Después `ruff check .`.
2. **Runtime en emulador** (skill `arrancar-viajaya`):
   - Levantar backend + emulador pasajero + emulador conductor.
   - Pasajero crea un viaje (`SEARCHING`); conductor lo ve en el pool y oferta.
   - **Matar la app del pasajero** (swipe-up / force-stop).
   - A los ~120 s: el conductor debe recibir `ride_closed` en vivo (tarjeta desaparece) y, si
     ofreció, `offer_rejected reason:"ride_cancelled"`; `GET /api/v1/rides/open` ya no la
     lista; el ride en BD quedó `cancelled`.
   - **Control de reconexión:** repetir pero reabrir la app del pasajero antes de 120 s → la
     solicitud sigue `searching` y el conductor la sigue viendo (la task se canceló).
3. **Carrera:** ofrecer y aceptar la oferta a los ~29 s de gracia → el auto-cancel no debe
   tirar abajo el viaje aceptado.
