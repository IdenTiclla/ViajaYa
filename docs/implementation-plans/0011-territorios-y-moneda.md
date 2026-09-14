# F03-A — País, zona, moneda y horario

Fecha inicial: 2026-09-13. Fase pendiente. Alcance acordado el 2026-09-13: solo F03-A;
el panel administrativo (F03-B) y las feature flags (F03-C) se posponen. Sin panel, el
catálogo se administra por migración/seed y no se activa comercialmente ningún país nuevo.

## Objetivo

Que Bolivia deje de ser una constante del código y pase a ser el primer registro de un
catálogo de países y zonas, con moneda y zona horaria explícitas en cada viaje, sin cambiar
el comportamiento actual para el usuario.

## Supuestos fijos que hoy existen (y se retiran)

| Dónde | Supuesto |
|---|---|
| `backend/app/domain/value_objects.py` · `ServiceAreaPoint` | Rechaza `country_code != "BO"` y valida contra `bolivia_covers` |
| `backend/app/domain/service_area.py` | Un único polígono `bolivia_admin0_ne10m.geojson` |
| `backend/app/api/v1/schemas/rides.py` (líneas ~46 y ~309) | Deriva `country_code="BO"` con `bolivia_covers` |
| `backend/app/application/use_cases/get_driver_earnings.py` | `ZoneInfo("America/La_Paz")` fijo |
| `backend/app/infrastructure/config.py` | `PHONE_OTP_ALLOWED_REGIONS=("BO",)` es la única fuente de regiones |
| `RideRequest.fare` / `Offer.price` (`Numeric(10,2)`) | Importe sin moneda |
| Mobile (`RequestCard`, `OfertaEnviadaScreen`, `FareKeypad`, …) | Literal `Bs` y `formatBolivianos`; prefijo `+591` en el selector de país |

## Entregas en orden

- [ ] A1 · Dominio: `Country`, `Zone`, `Money`; puerto `TerritoryRepository`; `ServiceAreaPoint` valida contra la zona resuelta.
- [ ] A2 · Persistencia: migraciones `0026_countries_zones` (catálogo + seed `BO`) y `0027_ride_currency_zone` (`currency`, `zone_id` en rides y `currency` en offers, backfill `BOB`).
- [ ] A3 · Casos de uso: resolución de zona al crear/editar viajes; ganancias con la zona horaria del conductor; OTP con las regiones del catálogo.
- [ ] A4 · API: `GET /api/v1/territory` (país, zonas activas, moneda, prefijo, servicios); `currency` en las respuestas de viaje y oferta. OpenAPI y tipos mobile regenerados.
- [ ] A5 · Mobile: `features/territory` que carga y cachea el catálogo; formateo de importes por moneda; prefijo del selector de país desde la API; sin cambio visual para Bolivia.
- [ ] A6 · Evidencia: unitarios de `Money`/resolución de zona/jornada; e2e de creación con zona y moneda; test con un país sintético `XX`/`XXX` que demuestra que no se mezclan monedas; PostgreSQL opt-in para el backfill.

## Decisiones técnicas

**Dominio (`app/domain/territory.py`)**

- `Country(code: str, name: str, currency: str, calling_code: str, default_timezone: str, phone_regions: tuple[str, ...])`. `code` ISO 3166-1 alfa-2, `currency` ISO 4217.
- `Zone(id, country_code, name, timezone, boundary: tuple[Point, ...], enabled: bool, services: frozenset[ServiceType])`. El contorno de Bolivia actual se convierte en la primera zona (`BO-ALL`), de modo que la cobertura no cambia.
- `Money(amount: Decimal, currency: str)`: frozen; `__add__`/`__sub__`/comparación lanzan `CurrencyMismatchError` si las monedas difieren. `FareOffer` pasa a envolver `Money`; los importes siguen siendo `Decimal(10,2)`.
- `ServiceAreaPoint` deja de importar `service_area`: recibe la zona ya resuelta por el caso de uso. `service_area.py` conserva el algoritmo point-in-polygon (`ring_covers`) y pierde el nombre `bolivia_*`.
- Puerto `TerritoryRepository`: `get_country(code)`, `list_enabled_zones(country_code | None)`, `resolve_zone(GeoPoint) -> Zone | None`. La resolución en memoria sobre las zonas activas basta para el volumen objetivo; PostGIS queda descartado en esta fase.

**Persistencia**

- Tablas `countries` y `zones` (boundary como JSONB GeoJSON, `enabled`, `services` como array de enum por valor, según la convención de `_enum_values`). Seed en la propia migración `0026`: `BO`/`BOB`/`+591`/`America/La_Paz` y la zona `BO-ALL` con el polígono versionado.
- `0027`: `ride_requests.currency CHAR(3) NOT NULL DEFAULT 'BOB'`, `ride_requests.zone_id FK`, `offers.currency CHAR(3) NOT NULL DEFAULT 'BOB'`; backfill de `zone_id` a `BO-ALL`. Constraint: la moneda de una oferta debe coincidir con la del viaje (se valida en `CreateOffer`, y la certificación PostgreSQL comprueba el `CHECK`/trigger elegido).
- Los `DEFAULT 'BOB'` se retiran en una migración posterior, cuando todos los productores envíen la moneda.

**Aplicación**

- `CreateRideRequest`/`EditRide`: resuelven la zona de origen y destino; ambos deben pertenecer a la **misma zona activa** que ofrezca el `ServiceType` pedido; la moneda del viaje es la del país de la zona. Fuera de cobertura → `InvalidLocationError` con el mismo mensaje actual.
- `CreateOffer`/`UpdateRideFare`: operan con `Money` en la moneda del viaje.
- `GetDriverEarnings`: la jornada se delimita con la zona horaria de la zona del último viaje del conductor (o la del país por defecto), no con una constante. Los totales se agrupan por moneda; con una sola moneda la respuesta no cambia de forma (`currency` se añade al schema).
- Teléfonos: `LibPhoneNumberNormalizer` recibe la unión de `phone_regions` de los países activos del catálogo; `PHONE_OTP_ALLOWED_REGIONS` queda como restricción adicional por entorno (intersección), no como única fuente.

**API y mobile**

- `GET /api/v1/territory` (público, cacheable): `{countries: [{code, name, currency, calling_code, zones: [{id, name, services, enabled}]}]}`. No expone contornos.
- `RideResponse`/`OfferResponse` añaden `currency`. `DriverEarningsResponse` añade `currency`.
- Mobile: `features/territory/{data,domain,application}` con caché en memoria + `AsyncStorage`; `formatMoney(amount, currency)` sustituye `formatBolivianos` en las pantallas listadas; el selector de país del acceso por teléfono toma `calling_code` del catálogo con `+591` como valor de respaldo si la API no responde.

## Fuera de alcance

Panel y CRUD de países (F03-B), flags por zona (F03-C), conversión de monedas y viajes
internacionales, PostGIS, y cualquier apertura comercial fuera de Bolivia.

## Criterio de cierre

Bolivia funciona igual que antes en Desarrollo (crear viaje, ofertar, ganancias) con
`currency = BOB` en todas las respuestas; un país sintético en tests demuestra que una
oferta en otra moneda se rechaza y que la jornada respeta otra zona horaria; migraciones
reversibles certificadas en PostgreSQL desechable; tsc/lint/tests y ruff/pytest verdes.
