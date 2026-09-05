@AGENTS.md

# ViajaYa — Mobile (Expo + React Native + TypeScript)

App de taxis y encomiendas. Expo Router (file-based, rutas tipadas), React Query (server state),
Zustand (auth/cliente), axios, react-native-maps, SSO Google/Facebook, tiempo real por WebSocket.

Stack: **Expo ~56.0.7** · React Native 0.85.3 · React 19 · TypeScript ~6.0.3 ·
`expo-router ~56.2.8` · `zustand ^5` · `@tanstack/react-query ^5` · `axios ^1.16` ·
`react-native-maps 1.27` · `react-hook-form ^7` + `zod ^4`.

> ⚠️ **Expo 56 cambió mucho.** Lee SIEMPRE los docs versionados antes de escribir código:
> https://docs.expo.dev/versions/v56.0.0/ (ver `AGENTS.md`).

## Arquitectura

Código organizado por **features**, cada uno en capas (Clean Architecture adaptada al cliente).
El enrutado (`src/app/`) solo monta pantallas; la lógica vive en `src/features/`.

```
src/
├── app/                 # Rutas (expo-router, file-based). Solo composición de pantallas.
│   ├── _layout.tsx        # Raíz: providers (QueryClient, SafeArea, GestureHandler) + gate por sesión/rol
│   ├── index.tsx          # Redirect por rol → (auth)/login | (app)/(tabs) | (driver)/(tabs)/solicitudes
│   ├── (auth)/            # login, register
│   ├── (app)/             # Grupo pasajero (guard: authenticated && !driver)
│   │   ├── _layout.tsx      # Monta <PassengerToaster/> sobre el stack
│   │   ├── (tabs)/          # Viaje · Historial · Billetera · Perfil  (PillTabBar)
│   │   └── booking/         # destination, configure, offers, trip, rating,
│   │                        #   pick-on-map, saved-places, edit-place
│   └── (driver)/          # Grupo conductor (guard: role === 'driver')
│       ├── _layout.tsx      # Monta useDriverPoolSocket() + <DriverToaster/>
│       ├── oferta-enviada.tsx
│       └── (tabs)/          # Solicitudes · Historial · Ganancias · Perfil  (PillTabBar)
│                            #   (index oculto vía tabBarButton: () => null → redirect a Solicitudes)
├── features/            # Una carpeta por feature, en capas (Clean Architecture).
│   ├── auth/              # domain/ · data/ · application/ · presentation/
│   ├── booking/           # 4 capas completas (flujo de reserva)
│   ├── home/              # data/ · application/ · presentation/ (sin domain/)
│   ├── rides/             # ofertas + ciclo de vida del viaje + hooks de WS del pasajero y conductor
│   │   ├── domain/          # types.ts · fareInput.ts · geo.ts · offerTags.ts
│   │   ├── data/            # ridesRepository.ts (DTO ↔ dominio)
│   │   ├── application/     # useRides · useRideMutations · useCloseFlow · useNegotiationSocket
│   │   └── presentation/    # FareKeypad · OfferLifeTimer · RideHistoryScreen · RideRatingCard · …
│   └── driver/            # application/ + presentation/ únicamente (reusa data/domain de rides)
│       ├── application/     # useDriverRequests (zustand) · useDriverToasts
│       └── presentation/    # SolicitudesEntrantesScreen · DriverTopBar · RequestCard · DriverSearchMap · …
├── core/               # Infra transversal
│   ├── components/       # PillTabBar (bottom bar Stitch: tab activo con pill amarillo)
│   ├── config/env.ts     # Config tipada desde Constants.expoConfig.extra
│   ├── http/             # client.ts (axios + interceptores token/refresh), tokenStorage (SecureStore)
│   ├── realtime/socket.ts # WS genérico con reconnect (token por subprotocol, backoff exponencial)
│   ├── errors/apiError.ts
│   ├── hooks/            # useCountdown (AppState-aware), …
│   └── theme/            # tokens.ts + index.ts (design system)
├── shared/components/  # UI reutilizable: Button, TextField, Checkbox, ConfirmDialog, SocialButton, …
└── store/authStore.ts  # Sesión global (zustand); se auto-logout si el refresh falla
```

### Reglas al añadir código

- **Respeta las capas del feature.** Las pantallas (`presentation/`) consumen hooks (`application/`),
  que llaman a repos/services (`data/`), que mapean a tipos de `domain/`. No hagas `fetch`/axios desde un componente.
- **Todo el IO HTTP pasa por `src/core/http/client.ts`** (instancia `api`). Ya adjunta el Bearer token
  y refresca ante 401 (dedupe de refresh concurrente). No crees instancias axios sueltas ni uses `fetch`.
- **Tiempo real: el WS es la vía principal; el polling de React Query es solo respaldo lento.**
  El WS muta la caché de React Query en vivo (vía `queryClient.setQueryData`). El token viaja
  como subprotocolo `viajaya.auth`, fuera de la URL y de los access logs.
- **Config solo desde `@/core/config/env`.** Nunca leas `process.env` en runtime; las claves se exponen
  vía `app.config.ts` → `extra` → `env`. Edita `.env` (ver `.env.example`) para valores locales.
- **Reusa `shared/components/`** antes de crear UI nueva; respeta los `theme/tokens`.
- **Alias de imports:** `@/*` → `src/*`, `@/assets/*` → `assets/*`. `experiments.typedRoutes: true`
  en `app.config.ts` → los `href` de `<Redirect>`/`navigate` están tipados.
- **Pantallas nuevas:** crea el archivo de ruta en `src/app/...` (1–5 líneas) y delega en un
  componente de `presentation/`.

## Routing por rol

`src/app/_layout.tsx` usa `<Stack.Protected guard=...>` con 3 guards mutuamente excluyentes:
`(app)` (auth && !driver), `(driver)` (driver), `(auth)` (!auth). `src/app/index.tsx` redirige:

- no autenticado → `/(auth)/login`
- pasajero → `/(app)/(tabs)` (tab inicial: Viaje)
- conductor → `/(driver)/(tabs)/solicitudes` (cae directo en Solicitudes, no en Inicio)

**Bottom bar Stitch** (`core/components/PillTabBar.tsx`, compartida por pasajero y conductor):
el tab activo lleva un pill de fondo amarillo (`colors.accent` = `#F5C518`) con icono+etiqueta oscuros.
Las rutas ocultas declaran `tabBarButton: () => null` (ej. el `index` redirect del conductor).

## State management

- **Server state → React Query** (`QueryClient` singleton: `retry:1`, `staleTime:30s`). Polling lento
  (15–20 s) como respaldo del WS en `useOpenRides`, `useRideOffers`, `useRide`, `useDriverActiveRide`.
- Las `queryFn` de viajes propagan `signal` hasta Axios. Conserva esa cadena al
  añadir consultas para que `cancelQueries` cancele también el transporte HTTP.
- El pool abierto y el historial usan `useInfiniteQuery` sobre el contrato
  `{items, next_cursor}`. La caché `['open-rides']` es `InfiniteData`: los eventos
  WS deben usar `features/rides/application/openRidesCache.ts`, no escribir arrays
  directamente.
- **Estado de sesión/cliente → Zustand**: `authStore` (sesión), `useBookingStore` (reserva),
  `useDriverRequests` (conjuntos `dismissed`/`offered`/`rejected`/`taken`/`expired`/`paused` del
  conductor), `usePassengerToasts` / `useDriverToasts` (toasts efímeros, máx 3).
- **Query keys** (convención de arrays): `['open-rides']`, `['ride-offers', rideId]`,
  `['ride', rideId]`, `['driver-active-ride']`, `['ride-history', status|'all']`, `['driver-earnings']`.
- **No dupliques estado de servidor en stores.**

### Hooks principales

- `features/rides/application/useRides.ts` — `useOpenRides`, `useRideOffers`, `useRide`, `useDriverActiveRide`.
- `features/rides/application/useRideMutations.ts` — `useCreateOffer`, `useAcceptOffer`, `useRejectOffer`,
  `useWithdrawOffer`, `useUpdateRideStatus`, `useCancelRide`, `useUpdateRideFare`, `useSetOnline`,
  `usePauseForEdit`, `useEditRide`.
- `features/rides/application/useCloseFlow.ts` — `useRideHistory`, `useDriverEarnings`, `useRateRide`.
- `features/rides/application/useNegotiationSocket.ts` — `useNegotiationSocket(rideId)` (pasajero) y
  **`useDriverPoolSocket()`** (conductor). Ambos en el MISMO archivo; el del conductor se monta una
  sola vez en `(driver)/_layout.tsx` (canal único).
- `features/driver/application/useDriverRequests.ts` — store del conductor + `useAutoExpireOffers()`
  (autocura ofertas vencidas sin evento WS: tick cada 1 s).

## WebSockets en el cliente

Infra: `core/realtime/socket.ts` — `openSocket(path, onMessage)`. Backoff exponencial (1 s→5 s),
reemplaza sockets suspendidos al volver a foreground (`AppState`) y procesa los mensajes en orden.
**Solo bajada**: parsea `{type,data}` y lo pasa al callback.

Los hooks usan parsers duales legacy/v2. Cada conexión debe completar primero
su snapshot y no puede mezclar protocolos: un hueco, conflicto, frame inválido o
fallo del handler descarta la generación del socket y fuerza otro handshake sin
perder los cursores ya confirmados. El gate v2 confirma cada ticket solo después
de actualizar React Query/Zustand; duplicados y posiciones antiguas no mutan ni
repiten avisos.
En un dev build, `core/realtime/diagnostics.ts` conserva un buffer acotado y
emite logs `[realtime]` con conexión, snapshot, código de cierre, causa de
descarte y resync. No añadas rutas, IDs, tokens, frames ni payloads a ese
contrato; permanece deshabilitado fuera de `__DEV__`.
Durante el rollout de correlación, `correlation_id` puede faltar en un evento v2
del backend anterior; mobile usa entonces `batch_id`. La correlación es metadata
diagnóstica y no cambia la identidad idempotente de un `event_id`.

Eventos que escuchan los hooks (WS → mutación de caché React Query + estado Zustand + toast):

- **Pasajero** (`/ws/rides/{rideId}`): `offers_snapshot`, `offer_created`, `offer_withdrawn`
  (salvo `reason==='superseded'`), `offer_expired`, `ride_status`.
- **Conductor** (`/ws/driver`): `open_rides_snapshot`, `driver_offers_snapshot` (rehidrata
  ofertas pendientes tras reiniciar), `ride_created`, `ride_closed`, `ride_paused`,
  `offer_accepted`, `offer_expired`, `offer_rejected` (`ride_taken`/`ride_cancelled`/`declined`),
  `offers_withdrawn`, `ride_status`, `driver_active_ride` (snapshot al reconectar).

Los reducers de `ride_status` son monótonos y contrastan detalle + viaje activo;
el mismo estado sí refresca el payload. `offer_expired` aplica por `offer_id`
exacto y solo notifica si retiró la oferta vigente. `offers_withdrawn` elimina
por los pares exactos `{ride_id, offer_id}` cuando están presentes, para que un
resumen atrasado no borre una reoferta; `ride_ids` se conserva como fallback
legacy. El éxito HTTP al pasar offline vacía además las ofertas vivas para
tolerar una caída del WebSocket.

El store del conductor conserva tombstones acotados por `offer_id`, rides
terminales, generaciones del pool y un token por intento HTTP. `markOffered` es
un CAS: el `201` tardío
de una oferta rechazada, expirada, pausada, aceptada, tomada, cancelada o retirada
no puede revivirla, ni una respuesta anterior ganar a otra petición. Los eventos
`ride_created` duplicados o atrasados no limpian desenlaces de otra generación.
`ride_closed` lleva `pool_version` y `reason=paused|terminal`: solo un cierre
aplicable retira la tarjeta y la oferta visible, y un terminal domina una pausa
de la misma generación. Un snapshot PostgreSQL `PENDING` sí corrige guards locales
contradictorios, incluida una expiración por reloj adelantado.

El snapshot v2 del pasajero reemplaza detalle, activo y ofertas bajo un único
watermark `ride:*`. El del conductor reemplaza pool abierto, pausados, ofertas y
`active_ride` (también cuando es `null`) con los watermarks de su vehículo,
delivery y `driver:*`. Para arbitrar un `201` concurrente no se comparan fechas:
PostgreSQL no ordena commits con `now()`. El store registra qué intentos locales
ya estaban en vuelo al aplicar el snapshot; si uno ausente resuelve después,
fuerza otro handshake que decide autoritativamente si sigue `PENDING`.

## Tema (design system)

`core/theme/tokens.ts` (única fuente de verdad; reexportado por `index.ts`):

- `colors.primary #16308C` (azul TaxiGo) · `colors.primaryDark #0F2266` · `colors.accent #F5C518`
  (amarillo Stitch: tab activo, estrellas, acentos) · `success #0F9D58` · `danger #D92D20` ·
  `text #1A1D23` · `textSecondary #60646C` · `surfaceMuted #F2F3F5` · `border #E2E4E8`.
- `spacing` xs/sm/md/lg/xl/xxl = 4/8/16/24/32/48 · `radius` sm/md/lg/pill = 8/12/16/999 ·
  `fontSize` xs…xxl = 12/14/16/20/24/32 · `fontWeight` regular/medium/semibold/bold.

Importa `{ colors, spacing, radius, fontSize, fontWeight }` desde `@/core/theme`. `app.config.ts`
usa `#16308C` para splash/adaptiveIcon.

## HTTP client

`core/http/client.ts`: instancia `api = axios.create({ baseURL: env.apiUrl, timeout: 15000 })`.

- **Request interceptor**: adjunta `Authorization: Bearer <accessToken>` desde `tokenStorage`.
- **Response interceptor**: ante 401 (si la URL no está en `NO_REFRESH_PATHS` y no es `_retry`),
  dispara `refreshAccessToken()` **compartido** (dedupe de concurrencia) → `POST /auth/refresh` →
  guarda el nuevo par → reintenta el original. Solo un refresh rechazado con 401
  (o sin credenciales) ejecuta `tokenStorage.clear()` + `onSessionExpired()`;
  red, timeout y 5xx conservan la sesión para reintentar. El refresh compartido
  siempre se libera en `finally`, incluso si falla SecureStore.
- `env.apiUrl` viene de `app.config.ts` → `extra.apiUrl`; `env.wsUrl` se deriva con `toWsUrl()`.
- Tokens en `expo-secure-store` (`viajaya.accessToken`/`viajaya.refreshToken`), nunca en AsyncStorage plano.
- El refresh también pasa por `api` con `skipAuth: true` y el timeout de 15 s;
  nunca debe quedar una renovación de sesión sin límite de espera.
- Home verifica activo y después calificación con un límite total de 30 s en
  `features/home/application/confirmarRecuperacion.ts`. Un fallo o timeout muestra
  Reintentar antes que el indicador de carga; reintentar repite la verificación
  completa. Una respuesta tardía no autoriza navegación después del timeout.
- Leer SecureStore tiene un límite de 5 s. El arranque completo tiene 30 s y
  muestra `SessionRecoveryScreen` con Reintentar si falla; conserva credenciales
  ante errores transitorios. Una generación evita restaurar un arranque anterior
  después de otro intento o de expirar la sesión.
- Confirmar/omitir calificación libera la mutación al recibir el éxito HTTP;
  las invalidaciones posteriores corren en segundo plano. Una lectura antigua se
  cancela antes de retirar de caché ese cierre, conservando otros pendientes.
- Las pantallas de recuperación priorizan errores sobre cargas de otras consultas.
  Una actualización en segundo plano no reemplaza por un spinner una pantalla ya
  verificada. Sin detalle de viaje, Viaje, Calificación y Edición permiten volver
  al inicio; una solicitud inaccesible también permite salir de Ofertas. Esa
  salida no cancela viajes: Home vuelve a consultar el estado autoritativo.

## Contrato con backend

API bajo `/api/v1`. Patrón del data layer (canónico: `features/rides/data/ridesRepository.ts`):

1. Importa `api` de `@/core/http/client` y tipos de `domain/types.ts`.
2. Define tipos DTO coincidiendo con el contrato backend (**snake_case**: `service_type`, `fare`
   como string decimal, `eta_min`, `full_name`, `accepted_price`, …).
3. Funciones `toX(dto): Dominio` (parsea `Number.parseFloat`, renombra a camelCase).
4. Exporta un objeto `ridesRepository = { … }` con los métodos `api.get/post/patch`.

**Doble `ridesRepository`**: `features/booking/data/ridesRepository.ts` (crea la solicitud `POST /rides`)
y `features/rides/data/ridesRepository.ts` (ofertas + ciclo de vida). Split intencional por feature.

**Al cambiar un endpoint o schema en el backend, actualiza el DTO/repositorio/tipo del mobile
aquí.** Mantén ambos lados en sintonía.

### Enums de dominio (mobile)

`ServiceType = 'taxi' | 'moto' | 'delivery'` · `PaymentMethod = 'qr' | 'cash'` ·
`RideStatus = 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled'` ·
`OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired'`. Oferta TTL = 30 s. Moneda = Bs (bolivianos).

## Comandos

```bash
cd mobile
npm install
cp .env.example .env       # API_URL (IP LAN del backend), claves Maps/OAuth

# Dev: flujo DEV BUILD (NO Expo Go). Hay android/ pregenerado, eas.json y expo-dev-client.
npx expo start             # dev server Metro
npm run android            # expo run:android  (dev client en emulador/dispositivo)
npm run ios                # expo run:ios

# Calidad (correr antes de commitear)
npx tsc --noEmit           # type-check estricto
npm run lint               # expo lint (eslint-config-expo)
```

> **Emulador Android:** se corre con el **dev-client** (no Expo Go). Requiere toolchain Android
> y un AVD; ver `~/.local` y `~/Android` en la máquina de desarrollo.

## Convenciones

- **TypeScript estricto** (`strict: true`); evita `any`, tipa los datos de la API en `domain/types.ts`.
- **Formularios:** react-hook-form + zod (`@hookform/resolvers`), esquemas junto al feature.
- **Mapas:** `react-native-maps`; ubicación con `expo-location` (permisos en `app.config.ts`).
  Estilo de mapa compartido: `features/booking/presentation/mapStyle.ts` (`declutteredMapStyle`).
- **Hooks AppState-aware** (no se congelan en background): `useCountdown`, `socket.ts` recalculan
  al volver a foreground. Sigue ese patrón al hacer hooks con tiempo/conexión.
- Comentarios/JSDoc en **español**, alineados con el estilo del repo.
- Antes de tocar APIs de Expo, confirma firmas en los docs de la **v56** (no asumas versiones previas).
