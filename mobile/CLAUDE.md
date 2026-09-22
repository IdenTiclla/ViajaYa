@AGENTS.md

# ViajaYa — Mobile (Expo + React Native + TypeScript)

App de taxis y encomiendas. Expo Router (file-based, rutas tipadas), React Query (server state),
Zustand (auth/cliente), axios, react-native-maps, acceso por teléfono + OTP con Google/Facebook
vinculados a un teléfono verificado (sin correo/contraseña), tiempo real por WebSocket.

Stack: **Expo ~56.0.7** · React Native 0.85.3 · React 19 · TypeScript ~6.0.3 ·
`expo-router ~56.2.8` · `zustand ^5` · `@tanstack/react-query ^5` · `axios ^1.16` ·
`react-native-maps 1.27` · `zod ^4` (esquemas de WS).

> ⚠️ **Expo 56 cambió mucho.** Lee SIEMPRE los docs versionados antes de escribir código:
> https://docs.expo.dev/versions/v56.0.0/ (ver `AGENTS.md`).

## Arquitectura

Código organizado por **features**, cada uno en capas (Clean Architecture adaptada al cliente).
El enrutado (`src/app/`) solo monta pantallas; la lógica vive en `src/features/`.

```
src/
├── app/                 # Rutas (expo-router, file-based). Solo composición de pantallas.
│   ├── _layout.tsx        # Raíz: providers (tema, QueryClient, SafeArea, GestureHandler) + gate por sesión/rol
│   ├── index.tsx          # Redirect por rol → (auth) | (app)/(tabs) | (driver)/(tabs)/solicitudes
│   ├── (auth)/            # index → PhoneEntryScreen: única vista de acceso (teléfono + OTP, Google).
│   │                      # Un número nuevo completa nombre + términos ahí mismo. Sin correo/contraseña
│   ├── (app)/             # Grupo pasajero (guard: authenticated && !driver)
│   │   ├── _layout.tsx      # Monta <PassengerToaster/> sobre el stack
│   │   ├── (tabs)/          # Viaje · Historial · Billetera · Perfil  (PillTabBar)
│   │   ├── booking/         # destination, configure, offers, trip, rating,
│   │   │                    #   pick-on-map, saved-places, edit-place
│   │   └── conductor/registro.tsx  # alta/edición de un vehículo (?vehicle=taxi|moto|truck) desde Perfil
│   ├── elegir-modo.tsx    # tras iniciar sesión un conductor aprobado elige modo y vehículo
│   └── (driver)/          # Grupo conductor (guard: role === 'driver')
│       ├── _layout.tsx      # Monta useDriverPoolSocket() + <DriverToaster/>
│       ├── oferta-enviada.tsx
│       └── (tabs)/          # Solicitudes · Historial · Ganancias · Perfil  (PillTabBar)
│                            #   (index oculto vía tabBarButton: () => null → redirect a Solicitudes)
├── features/            # Una carpeta por feature, en capas (Clean Architecture).
│   ├── auth/              # domain/ (types + vehicleCatalog: VEHICLE_META, SERVICES_FOR_VEHICLE) · data/
│   │                      #   · application/ (phoneAccessController + useAuthController)
│   │                      # presentation/: PhoneEntryScreen · PhoneCodeForm · AccountSecurityPanel
│   │                      #   entry/ = bloques de la vista de acceso (AuthScaffold, PhoneInput, SocialButtons, TermsCheckbox…)
│   ├── booking/           # 4 capas completas (flujo de reserva)
│   ├── home/              # domain/ (orientación) · data/ · application/ · presentation/
│   ├── rides/             # ofertas + ciclo de vida del viaje + hooks de WS del pasajero y conductor
│   │   ├── domain/          # types.ts · fareInput.ts · geo.ts · offerTags.ts
│   │   ├── data/            # ridesRepository.ts (DTO ↔ dominio)
│   │   ├── application/     # useRides · useRideMutations · useCloseFlow · useNegotiationSocket
│   │   └── presentation/    # FareKeypad · OfferLifeTimer · RideHistoryScreen · RideRatingCard · …
│   ├── profile/           # presentación del perfil de pasajero y selector de tema compartido
│   └── driver/            # reusa data/domain de rides para el pool; data/ propio solo para la cuenta
│       ├── domain/          # DriverVehicle (hasta uno por tipo; MAX_DRIVER_VEHICLES)
│       ├── data/            # driverAccountRepository (/drivers/me/vehicles · /me/mode)
│       ├── application/     # useDriverRequests (zustand) · useDriverToasts · useDriverAccount
│       └── presentation/    # SolicitudesEntrantesScreen · DriverTopBar · RequestCard · DriverSearchMap
│                            #   · RegistroConductorScreen · DriverAccountCard · SelectorVehiculo
│                            #   · ElegirModoScreen · PerfilConductorScreen · …
├── core/               # Infra transversal
│   ├── components/       # PillTabBar (bottom bar Stitch: tab activo con pill amarillo)
│   ├── config/env.ts     # Config tipada desde Constants.expoConfig.extra
│   ├── http/             # client.ts (axios + interceptores token/refresh), tokenStorage (SecureStore)
│   ├── realtime/socket.ts # WS genérico con reconnect (token por subprotocol, backoff exponencial)
│   ├── errors/apiError.ts
│   ├── hooks/            # useCountdown (AppState-aware), …
│   └── theme/            # paletas, estilos reactivos y preferencia local persistida
├── shared/components/  # UI reutilizable: Button, TextField, ConfirmDialog, FeedbackState, mapa/, …
└── store/authStore.ts  # Sesión global (zustand): bootstrap/`acceptPhoneSession`/signOut; auto-logout si el refresh falla
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

- no autenticado → `/(auth)` (`PhoneEntryScreen`: única pantalla de acceso, sin registro ni recuperación
  aparte). Un número nuevo pasa por `ProfileCompletionForm` (nombre + términos) tras el OTP.
  El controlador (`useAuthController()`) conserva el flujo de recuperación aunque hoy no tiene UI.
- pasajero → `/(app)/(tabs)` (tab inicial: Viaje)
- conductor → `/(driver)/(tabs)/solicitudes` (cae directo en Solicitudes, no en Inicio)

**Una cuenta, dos modos, hasta tres vehículos.** `user.role` es el modo activo que devuelve el
backend. En Perfil (pasajero) `DriverAccountCard` lista los vehículos (`useDriverVehicles`,
key `['driver-vehicles']`) con su estado y permite agregar/editar/quitar
(`RegistroConductorScreen`, `?vehicle=` edita ese tipo; al agregar solo se ofrecen los tipos
libres). Con vehículos aprobados, `SelectorVehiculo` muestra "Conducir con Taxi · placa" por cada
uno; elegir llama a `useSwitchAccountMode({mode:'driver', vehicleType})` (`POST /drivers/me/mode`),
que si el usuario está en línea primero lo desconecta, vacía React Query (`removeQueries`),
reemplaza `user` (`setUser`) y hace `router.replace('/')` para que los guards reenruten. En modo
conductor, Perfil permite cambiar de vehículo (otros aprobados) y volver a pasajero.

**Al iniciar sesión** con una cuenta con algún vehículo aprobado, `authStore.modeChoicePending`
queda en `true` y `index.tsx` redirige a `/elegir-modo` (`ElegirModoScreen`: "Pedir viajes" o
"Conducir con …" por vehículo). El arranque con sesión guardada (`bootstrap`) no vuelve a
preguntar. No dupliques ese flujo: la navegación por rol ya existente hace el resto.

**Bottom bar Stitch** (`core/components/PillTabBar.tsx`, compartida por pasajero y conductor):
el icono activo lleva un pill de fondo amarillo (`colors.accent` = `#F5C518`).
Todas las etiquetas permanecen debajo de su icono; con letra grande se distribuyen
en dos filas para conservar el texto completo.
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
- **Conductor** (`/ws/driver`): los streams requeridos del snapshot v2 son `driver:{id}` más
  un `pool:{service}` por cada `user.driverServices` (no "vehículo + delivery" fijo).
  `open_rides_snapshot`, `driver_offers_snapshot` (rehidrata
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

`core/theme/tokens.ts` contiene las paletas clara y oscura y los tokens de diseño.
La app inicia en **claro**, independientemente del sistema. **Perfil → Apariencia**
permite elegir Claro u Oscuro para pasajero y conductor. La preferencia vive en
`viajaya.tema` (SecureStore nativo; localStorage web), se conserva al cerrar sesión
y no modifica la cuenta del backend.

`ProveedorTema` sincroniza colores, Expo Router, StatusBar, Appearance y el fondo
nativo. Cambiar el tema actualiza el contexto sin remontar las pantallas ni perder
formularios o conexiones. `crearStoreTema` acota la lectura a 5 s, descarta resultados
anteriores a una elección y permite reintentar si el almacenamiento falla.

Paleta clara:

- `colors.primary #16308C` (azul TaxiGo) · `colors.primaryDark #0F2266` · `colors.accent #F5C518`
  (amarillo Stitch: tab activo, estrellas, acentos) · `success #167347` · `danger #C52C22` ·
  `text #182230` · `textSecondary #536174` · `surfaceMuted #F3F5F8` · `border #DCE2EB`.
- `bordeControl #7D8796` identifica campos y opciones; `border` se reserva para
  separadores decorativos. `primarioSuave` y `peligroSuave` acompañan las acciones
  secundarias con texto oscuro; los estados deshabilitados usan colores explícitos.
- `spacing` xs/sm/md/lg/xl/xxl = 4/8/16/24/32/48 · `radius` sm/md/lg/pill = 8/12/16/999 ·
  `fontSize` xs…xxl = 12/14/16/20/24/32 · `fontWeight` regular/medium/semibold/bold.

Paleta oscura: fondo `#10151F`, tarjetas `#192230`, texto `#F3F6FC`, primario
`#A8BDFF` y texto sobre primario `#10204E`. Ambos temas conservan contraste para
texto, controles y estados. `app.config.ts` mantiene `userInterfaceStyle: 'light'`
como base nativa; Appearance aplica después la elección explícita de la app.

Importa tokens de tamaño y los hooks desde `@/core/theme`. Dentro del componente,
usa `useTema()` para colores sueltos o `useEstilos(crearEstilos)` para obtener
`{ colors, styles, estiloFoco }`. Declara la fábrica fuera del componente:

```tsx
const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  tarjeta: { backgroundColor: colors.surface, padding: spacing.md },
});
```

No captures colores en `StyleSheet.create` ni tablas de iconos a nivel de módulo.
Los mapas usan `useEstiloMapa` y `userInterfaceStyle` explícito; cambiar tema debe
redibujar también los marcadores nativos. Usa `textoSobreAcento` sobre el amarillo.
Splash/adaptiveIcon conservan el azul de marca `#16308C`.

### Controles y accesibilidad

- Los iconos usan `@react-native-vector-icons/ionicons` y
  `@react-native-vector-icons/fontawesome`, con imports por familia. Se conserva
  la carga dinámica mediante `expo-font`: las fuentes viajan como assets de Metro.
  `expo.autolinking.exclude` en `package.json` excluye ambas familias para evitar
  copiarlas también al binario nativo. No añadas imports `/static`, plugins de estas
  familias ni fuentes manuales sin revisar conjuntamente esa configuración.
- Los símbolos propios del mapa viven en `shared/components/mapa/`: A circular
  para origen, B circular para destino y vehículos cenitales taxi/moto. Se dibujan
  con vistas nativas y tokens, sin fuentes de iconos. La letra A/B tiene escala
  fija porque forma parte del símbolo; la etiqueta y el nombre accesible conservan
  el significado. El pin de selección ancla el extremo del tallo al 50% del mapa,
  sin estimar la altura del texto. `MarcadorVehiculo` pertenece al mapa nativo:
  coordenadas GPS, `flat` y anclaje central; la rotación sigue el norte geográfico
  incluso al girar la cámara. El barrido del radar es solo decorativo. El GPS
  solicita actualizaciones cada segundo; el rumbo de movimiento fiable tiene
  prioridad y, al detenerse, se usa la brújula calibrada. Se conserva una sola
  suscripción mientras la pestaña de búsqueda está enfocada; Expo gestiona la
  pausa nativa en segundo plano. Volver a la app consulta permisos y servicios
  sin abrir diálogos ni recrear un watcher sano. Al perder foco se cancela incluso
  un alta pendiente. Una adquisición puntual con precisión equilibrada permite
  el primer centrado mientras llega el GPS preciso; se comparte si hay reintentos.
  El mapa se monta solo al recibir coordenadas recientes, sin una ciudad fija de
  respaldo; la carga tiene 15 s antes de ofrecer Reintentar y una señal tardía
  recupera el mapa. La cámara mide el contenedor y espera `onMapReady`; el primer
  centrado y seguimiento usan `setCamera`, con gestos bloqueados. El radar vive
  dentro de `DriverSearchMap` y toma la proyección GPS de `pointForCoordinate`;
  descarta respuestas atrasadas y se oculta si la proyección falla. Ver plan 0020.
- Reutiliza `Button` para acciones de formulario y pie de pantalla: altura mínima
  de 48, texto de 14 y crecimiento natural al ampliar la letra. Evita alturas
  fijas y `adjustsFontSizeToFit` para hacer caber etiquetas de acciones.
- Reserva `primary` para la acción principal, `secondary` para alternativas,
  `dangerSoft` para iniciar una acción destructiva y `danger` para confirmarla.
  Los botones y campos usan radio 16; `secondary` tiene fondo `surface` y borde
  `bordeControl`. Los estados pulsado, deshabilitado y cargando conservan su tamaño.
  En el seguimiento/negociación, `TripSecondaryAction` usa la variante `text` de
  `Button` para mantener cancelar u omitir en segundo plano; cancelar sigue
  requiriendo un diálogo destructivo. Conserva el objetivo táctil mínimo de 48.
  `loading` bloquea la acción e informa su estado; `accessibilityState.busy` puede
  comunicar una consulta en segundo plano que permite seguir interactuando.
- Conserva el foco de teclado visible (`estiloFoco`) y los estados de selección,
  carga y deshabilitado también mediante `aria-*`, compatibles con React Native
  y React Native Web. La selección se distingue además por una marca visible.
- Los campos mantienen etiquetas al escribir y asocian los errores mediante su
  pista de accesibilidad. `TextField` admite `helperText` (el error tiene prioridad)
  y `showCharacterCount` para valores controlados con `maxLength`.
  Los diálogos anclan la tarjeta abajo en móvil, desplazan solo el contenido y
  mantienen sus acciones visibles; al abrirse enfocan el título para el lector
  nativo. En pantallas amplias se centran y usan acciones horizontales.
  `PersonAvatar` unifica las iniciales decorativas; debe acompañarse del nombre
  completo accesible. `FeedbackState` bloquea el reintento mientras está cargando.
- Verifica los controles con texto al 200% y pantallas estrechas. Una
  previsualización web ayuda a comprobar geometría y teclado; TalkBack y
  VoiceOver requieren validación en dispositivo.
- La búsqueda conserva el acceso al mapa en carga, error y sin resultados.
  `useSeleccionDestino` invalida resoluciones anteriores al cambiar de búsqueda,
  elegir otro destino o salir de la pantalla; un fallo de recientes no es una lista vacía.
- Las ofertas separan precio, llegada estimada y vencimiento, conservando nombres
  y vehículos completos. Calificar permite omitir incluso tras elegir estrellas;
  mientras se envía o se omite, sus controles quedan bloqueados.

## HTTP client

`core/http/client.ts`: instancia `api = axios.create({ baseURL: env.apiUrl, timeout: 15000 })`.

- **Request interceptor**: adjunta `Authorization: Bearer <accessToken>` desde `tokenStorage`.
- **Response interceptor**: ante 401 (si la URL no está en `NO_REFRESH_PATHS` y no es `_retry`),
  dispara `refreshAccessToken()` **compartido** (dedupe de concurrencia) → `POST /auth/refresh` →
  guarda el nuevo par → reintenta el original. Un refresh rechazado con 401
  (o sin credenciales), o un segundo 401 con el token renovado, ejecuta
  `tokenStorage.clear()` + `onSessionExpired()`;
  red, timeout y 5xx conservan la sesión para reintentar. El refresh compartido
  siempre se libera en `finally`, incluso si falla SecureStore.
- `env.apiUrl` viene de `app.config.ts` → `extra.apiUrl`; `env.wsUrl` se deriva con `toWsUrl()`.
- Tokens en `expo-secure-store`, valor atómico `viajaya.session.v2` con `refreshRequestId`; las claves antiguas `viajaya.accessToken`/`viajaya.refreshToken` se leen para migración. Las escrituras se serializan, tienen espera acotada y el cierre deja una marca para impedir que claves antiguas restauren la sesión. Nunca usar AsyncStorage plano para credenciales.
- El refresh también pasa por `api` con `skipAuth: true` y el timeout de 15 s;
  nunca debe quedar una renovación de sesión sin límite de espera.
- Home verifica activo y después calificación con un límite total de 30 s en
  `features/home/application/confirmarRecuperacion.ts`. Un fallo o timeout muestra
  Reintentar antes que el indicador de carga; reintentar repite la verificación
  completa. Una respuesta tardía no autoriza navegación después del timeout.
- Leer SecureStore tiene un límite de 5 s. El arranque completo tiene 30 s y
  muestra `SessionRecoveryScreen` con Reintentar si falla; conserva credenciales
  ante errores transitorios. También ofrece Volver a iniciar sesión: el borrado
  nativo tiene un límite de 5 s y su fallo no bloquea el login. Los endpoints de
  acceso usan `skipAuth` para no depender de credenciales anteriores. Una
  generación descarta respuestas de arranque y renovaciones anteriores después
  de salir, iniciar otra sesión o expirar la actual.
- Confirmar/omitir calificación espera el asentamiento de las cancelaciones
  locales antes de retirar ese cierre de las cachés de activo/pendiente. No vuelve
  a cancelarlas al navegar: `CancelledError` no debe restaurar la pantalla de
  recuperación. Las invalidaciones posteriores corren en segundo plano; no se
  espera otra respuesta de red. Se conservan otros pendientes.
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

`ServiceType = 'taxi' | 'moto' | 'delivery' | 'moving'` · `VehicleType = 'taxi' | 'moto' | 'truck'`
(camioneta; solo atiende `moving`) · `DriverStatus = 'pending' | 'approved' | 'rejected'` ·
`PaymentMethod = 'qr' | 'cash'` ·
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
- **Formularios:** estado local + `TextField`/`Button` de `shared/components` (react-hook-form fue
  retirado con el registro por correo); `zod` se reserva para validar frames del WS.
- **Mapas:** `react-native-maps`; ubicación con `expo-location` (permisos en `app.config.ts`).
  Estilo de mapa compartido: `features/booking/presentation/mapStyle.ts` (`declutteredMapStyle`).
- **Apariencia de trayectos:** todas las vistas reutilizan `RoutePolyline` y
  `RoutePinMarker`; seguimiento y negociación usan además `TripRouteMap`.
  `routeTooltipLayout.ts` concentra las medidas lógicas comunes: trazo 3,
  contorno 5 y pin A/B de 16, sin variantes de tamaño por rol. Configuración
  conserva la edición al tocar los marcadores y permite activar nombres de
  lugares; se retiraron los dos bloques A/B superiores para ampliar el mapa. No dupliques la polilínea ni
  los estilos del pin en una pantalla. Conserva el contenedor nativo no aplanable,
  el anclaje al centro del símbolo y el redibujado cancelable tras cambios de layout.
  La colocación de tooltips comprueba todos los segmentos en la proyección de
  pantalla y mide el bloque completo (texto y Editar). Los mapas con ruta son
  cenitales y bloqueados (sin arrastre, zoom ni giro), por solicitud del usuario
  del 19/09/2026. Configuración mantiene un panel de alto estable entre servicios
  y mapa desde el borde superior, con Volver/lugares flotantes y cabecera medida;
  seguimiento usa márgenes compactos de 40/44 y reserva más espacio solo para
  direcciones largas. Búsqueda mide cabecera/panel, limita la hoja al 64 % y
  muestra el aviso de moto dentro del panel para no cubrir la ruta con letra grande.
  Todos los mapas desactivan `showsBuildings`, `showsIndoors`,
  `showsIndoorLevelPicker` y `pitchEnabled`. El estilo compartido oculta geometría
  de construcciones, terreno y POI, conservando parques/calles/nombres; activar
  nombres de lugares no debe restaurar sombras ni interiores. Ver plan 0021. Se busca
  espacio arriba/abajo con separación acotada. Si no cabe, conserva A/B y su
  título al tocarlo, sin dibujar la etiqueta sobre la ruta ni agrandar el bitmap
  sin límite. El onPress de edición/selección permanece disponible.
  Después de modificar los mapas, verifica también el paquete Android con Metro:
  TypeScript y las pruebas unitarias no detectan todos los fallos de resolución
  del servidor de desarrollo que recibe el teléfono.
- **Hooks AppState-aware** (no se congelan en background): `useCountdown`, `socket.ts` recalculan
  al volver a foreground. Sigue ese patrón al hacer hooks con tiempo/conexión.
- Código, identificadores, comentarios y JSDoc nuevos en **inglés**, según la preferencia persistente de `../AGENTS.md`. Conserva la interfaz en español y verifica cada implementación.
- Antes de tocar APIs de Expo, confirma firmas en los docs de la **v56** (no asumas versiones previas).


### ETA y elección de rutas

La ETA de oferta se calcula automáticamente desde una posición GPS reciente del
conductor a la recogida, usando el vehículo activo también para encomiendas. No
reintroducir minutos manuales ni usar duración origen→destino como ETA de llegada.
Google Routes usa tráfico óptimo y alternativas; elegir la más rápida válida, con
menor distancia como desempate. Una respuesta válida de 0 s y un punto se acepta
como llegada inmediata: Google puede omitir la distancia cero. La oferta conserva
el mínimo contractual de 1 min, sin estimaciones manuales ni rectas inventadas.
Distingue ruta inexistente, respuesta incompleta, proveedor no disponible, timeout
y desconexión; preserva cancelaciones. Configuración conserva el encuadre y los controles
al cambiar servicio; los errores no se disfrazan de una ruta recta. Ver plan 0014.


### Negociaciones simultáneas

Un conductor puede ofertar a varios pasajeros y cada pasajero comparar varios
conductores en su única solicitud. `useConcurrentOffers` usa promesas por envío
para conservar todos los callbacks aunque se solapen, y consulta las mutaciones
`automatic-driver-offer` para mantener el bloqueo por solicitud al navegar.
No usar un modal de carga ni un bloqueo global para calcular ETA/enviar una oferta.
La primera aceptación válida asigna un solo viaje y retira las demás ofertas del
ganador. `OfertaEnviadaScreen` muestra cualquier viaje asignado, incluso cuando se
estaba viendo otra negociación. Ver plan 0015.


Las ofertas automáticas envían `expected_pool_version` desde la solicitud mostrada.
Un 409 requiere refrescar/revisar la solicitud y recalcular ETA; no reenviar el
mismo borrador antiguo. El detalle de oferta usa `useNegotiationRide` para recuperar
solicitudes fuera de la primera página. Rechazo/expiración exactos conservan el
intento de una mejora distinta en vuelo; solo invalidan el ID indicado. Las
respuestas HTTP de un viaje anterior no sustituyen otro activo. Ver plan 0016.
