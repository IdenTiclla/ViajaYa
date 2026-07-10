# 0002 — Flujo de viaje con ofertas/contraofertas entre pasajero y conductores (auto/moto)

> **Estado: ✅ Entrega base implementada** (verificado el 2026-05-31).
> La negociación de ofertas y el viaje del conductor (`SEARCHING → … → COMPLETED`) están
> implementados en backend y mobile. Lo que **falta** es el **cierre del viaje** (calificación,
> historial y ganancias reales); ver **Parte 2 — Extensión: cierre del viaje** al final.

## Contexto

ViajaYa necesita el flujo central del producto, hoy inexistente: un **pasajero** publica una
solicitud con un **precio ofertado**; los **conductores** (auto = `taxi`, moto = `moto`) en línea
ven la solicitud y responden con **Aceptar** (al precio del pasajero) o **Contraofertar** (su propio
precio + ETA); el **pasajero revisa las ofertas recibidas y elige una**, asignando el conductor; el
viaje avanza por su ciclo de vida hasta completarse. La app debe **reconocer el rol** del usuario al
iniciar sesión y mostrar la **navegación de pasajero o de conductor** según corresponda.

**Estado real del código (verificado):**
- Backend `app/domain/entities.py` tiene `User` **sin rol**, `ServiceType {taxi, moto}`,
  `PaymentMethod {qr, cash}`, `RideStatus` **solo `searching`/`cancelled`** (el docstring dice
  textualmente que "la negociación de ofertas y el viaje en curso llegan en una entrega posterior"),
  `RideRequest {rider_id, origin, destination, service_type, fare, payment_method, status}`.
  **No existen** `UserRole`, conductor, `Offer`, `OfferStatus`, `driver_id`.
- Migraciones Alembic: solo `0001`→`0004` (users, ride_requests, payment_method, saved_places).
  **No hay** tablas de conductores ni ofertas.
- Repos: `RideRequestRepository` = `add`, `get_by_id`, `list_recent_destinations`. Sin ofertas.
- Mobile usa **Expo Router** (file-based) en `src/app/` con grupos `(auth)` y `(app)/(tabs)`;
  estado de sesión en `src/store/authStore.ts` (Zustand); `User` en
  `src/features/auth/domain/types.ts` **sin `role`**. Features: `auth`, `booking`, `home`
  (no hay feature `rides`). `OffersScreen.tsx` existe como placeholder "buscando conductores".
  HTTP único en `src/core/http/client.ts` (axios `api` con refresh 401). Moneda: **Bs.**

**Decisiones:** modelo de **contraofertas del conductor** (negociación; el pasajero elige entre las
ofertas). Tiempo real con **polling** (React Query `refetchInterval`, MVP). Alcance: seed de usuarios
+ navegación por rol + pantallas de pasajero y de conductor.

**Guía de UI (Stitch, proyecto "App de Reserva de Taxis" `14684144038839565664`).** Pantallas de
referencia: Selección de Servicio y Oferta, Buscando Ofertas, Ofertas Disponibles, Panel de Control
Ofertas (conductor), Detalle del Trayecto (conductor), Seguimiento del Viaje, Finalización del Viaje,
Confirmación de Oferta Aceptada. La pantalla de ofertas muestra tarjetas con conductor, calificación,
vehículo, ETA (`min`), precio (`Bs.`), "Tu oferta: Bs. 25" y botones **Aceptar** / **Contraoferta**.

---

## Flujo objetivo (máquina de estados)

`RideStatus`: `SEARCHING → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED` (+ `CANCELLED`).

1. Pasajero crea `RideRequest` (`service_type` auto/moto, `fare` ofertado, pago) → `SEARCHING`.
2. Conductores **en línea** cuyo `vehicle_type` coincide ven la solicitud. Cada uno crea una `Offer`
   (`PENDING`): **Aceptar** (`price = fare`) o **Contraoferta** (`price` propio + `eta_min`).
3. Pasajero ve las `Offer` `PENDING` y **acepta una** → esa oferta `ACCEPTED`, las demás `REJECTED`;
   `ride.driver_id`/`accepted_offer_id` fijados; ride → `ACCEPTED`.
4. Conductor avanza: `ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED`. Cancelación permitida antes de
   `IN_PROGRESS`.

---

## Backend (`backend/`, Clean Architecture)

### 1. Dominio — `app/domain/entities.py`
- [x] `UserRole(StrEnum)`: `PASSENGER`, `DRIVER`, `DELIVERY`.
- [x] `User`: `role: UserRole`, y para conductores `vehicle_type: ServiceType | None`,
  `plate: str | None`, `vehicle_model: str | None`, `rating: float | None`, `is_online: bool = False`
  (+ props `is_driver`, `is_social`).
- [x] `RideStatus`: `ACCEPTED`, `ARRIVING`, `IN_PROGRESS`, `COMPLETED` (mantiene `SEARCHING`/`CANCELLED`).
- [x] `RideRequest`: `driver_id: uuid.UUID | None = None`, `accepted_offer_id: uuid.UUID | None = None`.
- [x] `OfferStatus(StrEnum)`: `PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`.
- [x] `Offer` (`@dataclass`): `ride_id`, `driver_id`, `price: Decimal`, `eta_min: int | None`,
  `status: OfferStatus = PENDING`, `id`, `created_at`.

### 2. Dominio — `app/domain/repositories.py` y `app/domain/exceptions.py`
- [x] `RideRequestRepository` extendido: `update(ride)`, `list_open_for_service(service_type)`
  (estado `SEARCHING`), `list_by_driver(driver_id)`, `list_recent_destinations(rider_id, limit)`.
- [x] `OfferRepository`: `add`, `get_by_id`, `update`, `list_by_ride(ride_id)`,
  `reject_others(ride_id, keep_offer_id)`.
- [x] `UserRepository`: `update` (se usa para alternar `is_online`).
- [x] Excepciones (heredan `DomainError`): `RideNotFoundError`, `OfferNotFoundError`,
  `InvalidRideTransitionError`, `NotAuthorizedActionError`.

### 3. Aplicación — casos de uso (uno por archivo en `app/application/use_cases/`)
Patrón de `create_ride_request.py`; DTOs en `app/application/dto.py`.
- [x] `list_open_rides.py` (conductor: solicitudes abiertas de su `vehicle_type`).
- [x] `create_offer.py` (conductor: aceptar o contraofertar sobre ride `SEARCHING`).
- [x] `list_offers_for_ride.py` (pasajero: ofertas `PENDING` de su ride).
- [x] `accept_offer.py` (pasajero: marca oferta `ACCEPTED`, asigna conductor, rechaza el resto, ride→`ACCEPTED`).
- [x] `update_ride_status.py` (conductor: transiciones válidas `ARRIVING/IN_PROGRESS/COMPLETED`).
- [x] `cancel_ride.py` (pasajero/conductor).
- [x] `set_driver_online.py` (conductor: alterna `is_online`).
- [x] `get_ride.py` (polling de estado para ambos lados).
- [x] **(extra)** `get_driver_active_ride.py` (viaje activo del conductor: `ACCEPTED/ARRIVING/IN_PROGRESS`).
- [x] **(extra)** `list_recent_destinations.py` (destinos recientes del pasajero).

### 4. Infraestructura — `app/infrastructure/db/`
- [x] `models.py`: `UserModel` ampliado (rol + campos de conductor), `RideRequestModel`
  (`driver_id`, `accepted_offer_id`, nuevos estados), `OfferModel` (tabla `offers`).
- [x] `repositories.py`: métodos nuevos + `SqlAlchemyOfferRepository` (incl. `reject_others`).
- [x] **Migración** `migrations/versions/0005_drivers_and_offers.py`: columnas de rol/conductor en
  `users`, `driver_id`/`accepted_offer_id` en `ride_requests`, tabla `offers`.
- [x] **(extra)** Migración `0006_normalize_enum_values.py`: normaliza valores enum a minúscula en BD.

### 5. API — `app/api/v1/`
- [x] `schemas/`: `offers.py` (`OfferCreate {price, eta_min, accept_at_fare}`, `OfferResponse`),
  `rides.py` (`RideStatusUpdate`, `OpenRideResponse`, `RideResponse` con conductor/estado),
  `drivers.py` (`OnlineRequest`). `schemas/auth.py` expone `role`/`vehicle_type`.
- [x] `routers/rides.py`: `GET /rides/open`, `GET /rides/{id}`, `GET /rides/{id}/offers`,
  `POST /rides/{id}/offers`, `POST /rides/offers/{offer_id}/accept`, `PATCH /rides/{id}/status`,
  `POST /rides/{id}/cancel`, `GET /rides/recent-destinations` (extra).
- [x] `routers/drivers.py`: `POST /drivers/me/online` (toggle) + `GET /drivers/me/active-ride`
  (extra). Todo protegido con `CurrentUserDep`; valida rol.
- [x] `api/deps.py`: factories `get_*` + `Annotated[...]` por caso de uso y `OfferRepository`.
- [x] `api/errors.py`: excepciones nuevas mapeadas a HTTP (404/403/409).

### 6. Seed — `backend/scripts/seed.py`
- [x] Script async **idempotente** (`AsyncSession`, `bcrypt_hasher`, `UserRepository`), password común
  `ViajaYa1234#`. Crea **2 por rol** si no existen:
  - Pasajeros: `passenger1@viajaya.com`, `passenger2@viajaya.com`.
  - Conductor **auto**: `driver.auto1@viajaya.com`, `driver.auto2@viajaya.com` (`vehicle_type=taxi`).
  - Conductor **moto**: `driver.moto1@viajaya.com`, `driver.moto2@viajaya.com` (`vehicle_type=moto`).
  Ejecutar con `python -m scripts.seed`.

### 7. Tests — `backend/tests/`
- [x] `unit/test_offer_use_cases.py` (con `tests/fakes.py`): `create_offer`, `accept_offer`
  (asigna conductor, rechaza el resto), `update_ride_status` (transiciones válidas/inválidas),
  `set_driver_online`, `list_open_rides`.
- [x] `e2e/test_offers_flow_api.py`: flujo completo — pasajero crea ride → 2 conductores ofertan
  (uno acepta, otro contraoferta) → pasajero elige una → conductor avanza hasta `COMPLETED`.

---

## Mobile (`mobile/`, Expo Router + features)

### 1. Rol en el cliente
- [x] `src/features/auth/domain/types.ts`: `role` y `vehicleType` en `User`.
  Mapeado en `src/features/auth/data/mappers.ts`.

### 2. Navegación por rol — `src/app/`
- [x] Grupo `src/app/(driver)/` con `(tabs)`: `index` (Inicio Conductor),
  `solicitudes`, `ganancias`, `profile`, + `trayecto.tsx` (detalle de solicitud).
- [x] `src/app/_layout.tsx` / `src/app/index.tsx`: destino por `authStore.user.role`
  → `(driver)` si conductor, `(app)` si pasajero.

### 3. Feature `rides` (nuevo) — datos, dominio y estado compartido
- [x] `src/features/rides/domain/types.ts`: `Offer`, `OfferStatus`, `OpenRide`, `Ride`, `RideStatus`.
- [x] `src/features/rides/data/ridesRepository.ts`: `getOpenRides`, `getRide`, `listOffers`,
  `createOffer`, `acceptOffer`, `updateStatus`, `cancel`, `setOnline`, `getActiveRide`
  (con mappers DTO↔dominio sobre `api`).
- [x] `src/features/rides/application/`: hooks React Query con `refetchInterval`:
  `useOpenRides`, `useRideOffers`, `useRide` (polling), `useDriverActiveRide`, y mutations
  `useCreateOffer`, `useAcceptOffer`, `useUpdateRideStatus`, `useCancelRide`, `useSetOnline`.

### 4. Pantallas pasajero (extender `booking`, guía Stitch)
- [x] **Selección de Servicio y Oferta**: `ConfigureTripScreen.tsx` — selector auto/moto, precio
  ofertado editable (Bs.), método de pago, botón "Buscar Ofertas".
- [x] **Buscando Conductor + Ofertas**: `OffersScreen.tsx` — polling de `GET /rides/{id}/offers`;
  tarjetas con conductor, calificación, vehículo, ETA y precio, **Aceptar** por oferta; estado
  vacío "Buscando conductor…".
- [x] **Viaje en Curso (Pasajero)**: `src/app/(app)/booking/trip.tsx` + `TripScreen.tsx` con polling
  del estado del ride y botón cancelar.

### 5. Pantallas conductor (nuevas, feature `driver`, guía Stitch)
- [x] `InicioConductorScreen`: toggle En línea/Desconectado (`POST /drivers/me/online`), resumen.
- [x] `SolicitudesEntrantesScreen` (+ `RequestCard`, `SolicitudesMapa`, `CounterOfferModal`):
  lista/mapa (polling) de `GET /rides/open`, acciones **Aceptar** / **Contraofertar** (modal precio + ETA).
- [x] `ViajeEnCursoConductorScreen` (+ `DetalleTrayectoScreen`): avanza estado
  (`Llegué` → `Iniciar` → `Finalizar`) vía `PATCH /rides/{id}/status`.
- [x] `PerfilConductorScreen`: datos del vehículo + logout.
- [x] `GananciasConductorScreen`: datos reales (`useDriverEarnings`) — entregado en **Parte 2**.

### 6. Contrato en sintonía
- [x] Schemas del backend reflejados en `features/rides/domain/types.ts` y métodos en `data/`.
  Moneda Bs. en toda la UI.

### Cierre del viaje (entregado en Parte 2)
- [x] Calificación post-viaje (pasajero ↔ conductor).
- [x] Historial de viajes: `(app)/(tabs)/history.tsx` (pasajero) y `(driver)/historial.tsx` (conductor).
- [x] Ganancias reales del conductor.
- [x] Vistas del viaje en curso con mapa (seguimiento pasajero / navegación conductor).
- [ ] *(fuera de alcance)* Billetera del pasajero: `(app)/(tabs)/wallet.tsx` (sigue placeholder).

---

## Orden de implementación

1. Backend: dominio → repos/excepciones → casos de uso → models/migración `0005` → schemas/routers/deps/errors.
2. Backend: `scripts/seed.py` + `role`/`vehicle_type` en auth. Tests unit + e2e.
3. Mobile: rol en `User` + navegación por rol (grupo `(driver)`).
4. Mobile: feature `rides` (repo + hooks polling) → pantallas pasajero → pantallas conductor.
5. Calidad y reconstrucción de la app para revisión.

---

## Verificación (end-to-end)

**Backend**
```bash
cd backend && source .venv/bin/activate
docker compose up -d db            # desde la raíz
alembic upgrade head               # incluye 0005
python -m scripts.seed             # crea usuarios de prueba
ruff check . && pytest             # lint + unit + e2e
uvicorn app.main:app --reload --port 8000   # smoke en /docs
```
Smoke en Swagger: login `passenger1@viajaya.com` (`ViajaYa1234#`) → crear ride taxi; login
`driver.auto1@...` → online → `GET /rides/open` → ofertar; pasajero → `GET /rides/{id}/offers`
→ aceptar; conductor → `PATCH /status` hasta `COMPLETED`.

**Mobile (reconstrucción para revisión)**
```bash
cd mobile
npx tsc --noEmit && npm run lint   # type-check + lint
npx expo start -c                  # reconstruir con caché limpia
```
Probar dos sesiones: pasajero (crea oferta, recibe contraofertas, elige una, ve el viaje) y
conductor auto/moto (en línea, ve la solicitud, acepta/contraoferta, es elegido, completa el viaje).

---

# Parte 2 — Extensión: cierre del viaje (calificación · historial · ganancias)

> **Estado: ✅ Completado** (2026-05-31). Backend (67 tests verdes, migración `0007` aplicada) y
> mobile (`tsc` + `lint` limpios). Alcance entregado: **calificación post-viaje**, **historial de
> viajes** y **ganancias reales del conductor**. La billetera del pasajero queda fuera.
>
> Implementado en mobile:
> - [x] **Vistas del viaje en curso con mapa** (estilo Stitch): `TripRouteMap` compartido (mapa + ruta
>   por calles). Pasajero (`TripScreen`): seguimiento con tarjeta del conductor (Mensaje/Llamar/Compartir)
>   y banner "en camino" (`accepted`) vs "llegó" (`arriving`). Conductor (`ViajeEnCursoConductorScreen`):
>   mapa + banner de navegación + direcciones + botón por estado (Llegué→Iniciar→Finalizar);
>   `SolicitudesEntrantesScreen` lo monta a pantalla completa.
> - [x] `RideRatingCard` reutilizable + `RatingScreen` + ruta `(app)/booking/rating.tsx`; `TripScreen`
>   (pasajero) navega a calificar al `completed`; `ViajeEnCursoConductorScreen` (conductor) muestra la
>   tarjeta para calificar al pasajero al `completed`.
> - [x] Historial real en `(app)/(tabs)/history.tsx` (tabs Completados/Cancelados) vía
>   `RideHistoryScreen`; acceso del conductor en `(driver)/historial.tsx` (enlace desde su perfil).
> - [x] `GananciasConductorScreen` con `useDriverEarnings` (datos reales).

## Flujo objetivo (actualizado)

`COMPLETED` deja de ser un terminal "muerto": al completarse, **cada parte califica a la otra**;
pasajero y conductor consultan su **historial** y el conductor ve sus **ganancias** reales.

```
… IN_PROGRESS → COMPLETED → [Calificación pasajero ↔ conductor] → Historial / Ganancias
```

**Diseños Stitch de referencia (proyecto `14684144038839565664`):**
- *Viaje Finalizado - Pasajero*: "¡Has llegado a tu destino!", tarjetas Costo/Distancia/Duración,
  tarjeta del conductor (foto, vehículo, placa), **calificación 5 estrellas**, comentario opcional,
  método de pago, botón **Finalizar**.
- *Finalización del Viaje* (conductor): igual, califica al **pasajero**, botones **Listo** y **Ver Recibo**.
- *Historial de Viajes*: tabs **Completados / Cancelados**, tarjetas con destino, fecha/hora,
  vehículo, precio (Bs.) y rating.

---

## Backend (`backend/`, Clean Architecture)

### 1. Dominio — `app/domain/entities.py`
- `RideRating` (`@dataclass`): `id`, `ride_id`, `rater_id`, `ratee_id`, `score: int` (1–5),
  `comment: str | None`, `created_at`.

### 2. Dominio — `repositories.py` y `exceptions.py`
- Nueva `RatingRepository(ABC)`: `add(rating)`, `get_by_ride_and_rater(ride_id, rater_id)`,
  `list_by_ratee(ratee_id)`, `average_for(ratee_id) -> float | None`.
- Extender `RideRequestRepository`: `list_history(user_id, role, status)` — viajes terminales
  (`COMPLETED`/`CANCELLED`) por `rider_id` (pasajero) o `driver_id` (conductor), orden desc
  (patrón de `list_by_driver`).
- Excepciones nuevas (heredan `DomainError`): `RideNotCompletedError`, `AlreadyRatedError`.

### 3. Aplicación — casos de uso (uno por archivo)
- `rate_ride.py`: valida ride `COMPLETED` y que `current_user` sea el `rider` o el `driver`; infiere
  dirección (rider→califica driver; driver→califica rider); evita doble voto (`AlreadyRatedError`);
  persiste `RideRating`; **si el calificado es conductor, recalcula `User.rating`** =
  `RatingRepository.average_for(driver_id)` y `UserRepository.update`.
- `list_ride_history.py`: historial según rol, enriquecido para las tarjetas (destino, fecha,
  vehículo/conductor, precio acordado, rating).
- `get_driver_earnings.py`: agrega `COMPLETED` del conductor (precio = `accepted_price`):
  `total_today`, `trips_today`, `total_all_time`, `trips_all_time`, lista breve por viaje.
  DTOs en `app/application/dto.py`.

### 4. Infraestructura — `app/infrastructure/db/`
- `models.py`: `RideRatingModel` (tabla `ride_ratings`): `id`, `ride_id` FK→`ride_requests` CASCADE,
  `rater_id`/`ratee_id` FK→`users`, `score` (Integer), `comment` (Text|null), `created_at`;
  **único `(ride_id, rater_id)`** para impedir doble voto.
- `repositories.py`: `SqlAlchemyRatingRepository` + `list_history` en `SqlAlchemyRideRequestRepository`.
- **Migración `migrations/versions/0007_ride_ratings.py`**: crea `ride_ratings` con su único.

### 5. API — `app/api/v1/`
- `schemas/ratings.py` (nuevo): `RatingCreate {score, comment?}`, `RatingResponse`.
- `schemas/rides.py`: `RideHistoryItemResponse` (destino, fecha, vehículo/conductor, precio, rating, status).
- `schemas/drivers.py`: `DriverEarningsResponse` (totales + items).
- `routers/rides.py`: `POST /rides/{ride_id}/rating`, `GET /rides/history?status=`.
- `routers/drivers.py`: `GET /drivers/me/earnings`.
- `api/deps.py`: factories `get_rate_ride`, `get_list_ride_history`, `get_driver_earnings` +
  `RatingRepositoryDep`.
- `api/errors.py`: `RideNotCompletedError`→409, `AlreadyRatedError`→409.

### 6. Tests — `backend/tests/`
- `unit/test_rating_use_cases.py`: `rate_ride` (dirección correcta, recálculo del rating del
  conductor, rechazo si no `COMPLETED`, doble voto, tercero ajeno) y `get_driver_earnings`.
- `e2e/` (ampliar `test_offers_flow_api.py` o nuevo `test_close_flow_api.py`): tras `COMPLETED`,
  pasajero califica → `GET /drivers/me/earnings` lo refleja → `GET /rides/history` lo lista.

---

## Mobile (`mobile/`, feature `rides`/`driver`)

### 1. Contrato — `features/rides/domain/types.ts` + `data/ridesRepository.ts`
- Tipos: `RatingInput {score, comment?}`, `RideHistoryItem`, `DriverEarnings`.
- Métodos repo: `rateRide(rideId, input)`, `getHistory(status)`, `getEarnings()`.
- Hooks (`application/`): `useRideHistory(status)`, `useDriverEarnings()`, `useRateRide()`
  (invalida `ride`, `ride-history`, `driver-earnings`).

### 2. Calificación post-viaje (estilo *Viaje Finalizado*)
- Componente reutilizable `RatingScreen` (estrellas 1–5 + comentario + resumen
  costo/distancia/método de pago + tarjeta de la contraparte), parametrizado por rol.
- **Pasajero**: ruta `src/app/(app)/booking/rating.tsx`; al detectar `status === 'completed'` en
  `TripScreen.tsx`, redirigir aquí; "Finalizar" → vuelve al home.
- **Conductor**: tras `Finalizar` (status→`completed`) en `ViajeEnCursoConductorScreen.tsx` /
  `(driver)/trayecto.tsx`, mostrar `RatingScreen` calificando al **pasajero** + "Ver Recibo"
  (resumen del viaje; sin backend extra).

### 3. Historial (estilo *Historial de Viajes*)
- **Pasajero**: implementar `src/app/(app)/(tabs)/history.tsx` con tabs **Completados/Cancelados**,
  `FlatList` de tarjetas (destino, fecha, vehículo, precio Bs., rating) vía `useRideHistory`.
- **Conductor**: acceso a historial (tab o desde perfil) reutilizando la misma lista, según rol.

### 4. Ganancias reales — `features/driver/presentation/GananciasConductorScreen.tsx`
- Reemplazar el placeholder por `useDriverEarnings`: total de hoy, nº de viajes, total histórico y
  lista breve de viajes recientes con importe.

### 5. Contrato en sintonía
- Cada schema nuevo del backend se refleja en `features/rides` y su método `data/`. Moneda **Bs.**

### Mapa pantallas Stitch → archivos

| Pantalla Stitch | Archivo mobile |
|---|---|
| Viaje Finalizado - Pasajero | `(app)/booking/rating.tsx` + `RatingScreen` |
| Finalización del Viaje (conductor) | `RatingScreen` (rol driver) desde `(driver)/trayecto.tsx` |
| Historial de Viajes | `(app)/(tabs)/history.tsx` + lista compartida |
| Seguimiento / En Camino / Navegación | ya implementadas (`TripScreen`, `ViajeEnCursoConductorScreen`) — referencia visual |

---

## Orden de implementación (Parte 2)

1. Backend: dominio → repos/excepciones → casos de uso → `RideRatingModel`/migración `0007` →
   schemas/routers/deps/errors. Tests unit + e2e.
2. Mobile: tipos + repo + hooks → `RatingScreen` y wiring del completado → historial → ganancias.
3. Calidad (`ruff`/`pytest`; `tsc`/`lint`) y reconstrucción para revisión.

## Verificación (Parte 2)

**Backend**
```bash
cd backend && source .venv/bin/activate
alembic upgrade head          # incluye 0007
ruff check . && pytest        # unit + e2e (cierre del viaje)
```
Smoke en Swagger: completar un viaje → `POST /rides/{id}/rating` (pasajero) → cambia el `rating` del
conductor → `GET /drivers/me/earnings` lo suma → `GET /rides/history?status=completed` lo lista.

**Mobile**
```bash
cd mobile && npx tsc --noEmit && npm run lint && npx expo start -c
```
Dos sesiones: pasajero completa viaje → califica → ve historial; conductor finaliza → califica al
pasajero → ve ganancias e historial.
