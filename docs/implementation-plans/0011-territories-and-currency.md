# F03-A — Country, zone, currency and time zone

Initial date: 2026-09-13. Planning update: 2026-09-19. Phase pending implementation. Scope agreed on 2026-09-13: F03-A only;
the admin panel (F03-B) and feature flags (F03-C) are postponed. Without a panel, the
catalog is managed through migration/seed and no new country is commercially enabled.

The 2026-09-19 review confirms that the code keeps Bolivia/BOB and `America/La_Paz`
as fixed assumptions. F03-B/C remain pending before launch. The current head
is `0028_driver_vehicles`: `0026` removed passwords and `0027` added driver
requests. The revisions `0029`/`0030` proposed below are planning names;
check the head when implementing them and do not reuse existing IDs.

## Goal

Make Bolivia stop being a code constant and become the first record of a
catalog of countries and zones, with an explicit currency and time zone on each ride, without changing
the current behavior for the user.

## Fixed assumptions that exist today (and are removed)

| Where | Assumption |
|---|---|
| `backend/app/domain/value_objects.py` · `ServiceAreaPoint` | Rejects `country_code != "BO"` and validates against `bolivia_covers` |
| `backend/app/domain/service_area.py` | A single polygon `bolivia_admin0_ne10m.geojson` |
| `backend/app/api/v1/schemas/rides.py` (lines ~46 and ~309) | Derives `country_code="BO"` with `bolivia_covers` |
| `backend/app/application/use_cases/get_driver_earnings.py` | Fixed `ZoneInfo("America/La_Paz")` |
| `backend/app/infrastructure/config.py` | `PHONE_OTP_ALLOWED_REGIONS=("BO",)` is the only source of regions |
| `RideRequest.fare` / `Offer.price` (`Numeric(10,2)`) | Amount without currency |
| Mobile (`RequestCard`, `OfferSentScreen`, `FareKeypad`, …) | Literal `Bs` and `formatBolivianos`; `+591` prefix in the country selector |

## Deliveries in order

- [ ] A1 · Domain: `Country`, `Zone`, `Money`; `TerritoryRepository` port; `ServiceAreaPoint` validates against the resolved zone.
- [ ] A2 · Persistence: revisions after `0028`, proposed `0029_countries_zones` (catalog + `BO` seed) and `0030_ride_currency_zone` (`currency`, `zone_id` on rides and `currency` on offers, `BOB` backfill). Confirm the numbering when starting.
- [ ] A3 · Use cases: zone resolution when creating/editing rides; earnings with the driver's time zone; OTP with the catalog regions.
- [ ] A4 · API: `GET /api/v1/territory` (country, active zones, currency, prefix, services); `currency` in ride and offer responses. OpenAPI and mobile types regenerated.
- [ ] A5 · Mobile: `features/territory` that loads and caches the catalog; amount formatting per currency; country selector prefix from the API; no visual change for Bolivia.
- [ ] A6 · Evidence: unit tests for `Money`/zone resolution/workday; e2e of creation with zone and currency; a test with a synthetic `XX`/`XXX` country proving currencies are not mixed; opt-in PostgreSQL for the backfill.

## Technical decisions

**Domain (`app/domain/territory.py`)**

- `Country(code: str, name: str, currency: str, calling_code: str, default_timezone: str, phone_regions: tuple[str, ...])`. `code` ISO 3166-1 alpha-2, `currency` ISO 4217.
- `Zone(id, country_code, name, timezone, boundary: tuple[Point, ...], enabled: bool, services: frozenset[ServiceType])`. The current Bolivia outline becomes the first zone (`BO-ALL`), so coverage does not change.
- `Money(amount: Decimal, currency: str)`: frozen; `__add__`/`__sub__`/comparison raise `CurrencyMismatchError` if the currencies differ. `FareOffer` wraps `Money`; amounts remain `Decimal(10,2)`.
- `ServiceAreaPoint` stops importing `service_area`: it receives the zone already resolved by the use case. `service_area.py` keeps the point-in-polygon algorithm (`ring_covers`) and loses the `bolivia_*` name.
- `TerritoryRepository` port: `get_country(code)`, `list_enabled_zones(country_code | None)`, `resolve_zone(GeoPoint) -> Zone | None`. In-memory resolution over the active zones is enough for the target volume; PostGIS is ruled out in this phase.

**Persistence**

- `countries` and `zones` tables (boundary as GeoJSON JSONB, `enabled`, `services` as an array of enum by value, following the `_enum_values` convention). Seed in the catalog revision (proposed `0029`): `BO`/`BOB`/`+591`/`America/La_Paz` and the `BO-ALL` zone with the versioned polygon.
- Currency/zone revision (proposed `0030`): `ride_requests.currency CHAR(3) NOT NULL DEFAULT 'BOB'`, `ride_requests.zone_id FK`, `offers.currency CHAR(3) NOT NULL DEFAULT 'BOB'`; backfill of `zone_id` to `BO-ALL`. Constraint: an offer's currency must match the ride's (validated in `CreateOffer`, and the PostgreSQL certification checks the chosen `CHECK`/trigger).
- The `DEFAULT 'BOB'` values are removed in a later migration, when every producer sends the currency.

**Application**

- `CreateRideRequest`/`EditRide`: resolve the origin and destination zones; both must belong to the **same active zone** that offers the requested `ServiceType`; the ride's currency is that of the zone's country. Out of coverage → `InvalidLocationError` with the same current message.
- `CreateOffer`/`UpdateRideFare`: operate with `Money` in the ride's currency.
- `GetDriverEarnings`: the workday is bounded with the time zone of the zone of the driver's last ride (or the country default), not with a constant. Totals are grouped by currency; with a single currency the response keeps its shape (`currency` is added to the schema).
- Phones: `LibPhoneNumberNormalizer` receives the union of `phone_regions` of the catalog's active countries; `PHONE_OTP_ALLOWED_REGIONS` remains as an additional per-environment restriction (intersection), not as the only source.

**API and mobile**

- `GET /api/v1/territory` (public, cacheable): `{countries: [{code, name, currency, calling_code, zones: [{id, name, services, enabled}]}]}`. It does not expose outlines.
- `RideResponse`/`OfferResponse` add `currency`. `DriverEarningsResponse` adds `currency`.
- Mobile: `features/territory/{data,domain,application}` with an in-memory + `AsyncStorage` cache; `formatMoney(amount, currency)` replaces `formatBolivianos` on the listed screens; the phone-access country selector takes `calling_code` from the catalog with `+591` as the fallback value if the API does not respond.

## Out of scope

Country panel and CRUD (F03-B), per-zone flags (F03-C), currency conversion and international
rides, PostGIS, and any commercial launch outside Bolivia.

`BO-ALL` preserves the development/testing behavior; before launch, the
really operable cities/zones are configured. The catalog does not by itself authorize
enabling all of Bolivia or the `moving` service, whose commercial inclusion is still to be decided.

## Exit criterion

Bolivia works as before in Development (create ride, make offers, earnings) with
`currency = BOB` in every response; a synthetic country in tests proves that an
offer in another currency is rejected and that the workday respects another time zone; reversible
migrations certified on disposable PostgreSQL; tsc/lint/tests and ruff/pytest green.
