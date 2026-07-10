# Plan 0005 — Cierre del flujo de negociación pasajero ↔ conductor

> **Scope acordado:** flujo de negociación completo (sin "reanudar viaje al reabrir la app").
> **Creado:** 2026-06-26. Sigue las convenciones de `docs/implementation-plans/0002…0004`.

## Contexto

El flujo de negociación hoy *funciona* end-to-end (crear solicitud → conductores ofertan → pasajero
acepta/modifica/cancela), pero tiene **gaps de UX y bugs** que rompen la experiencia y, en un caso,
impiden completar una acción clave. El usuario reportó tres puntos; la exploración los confirmó y
corrigió, y además descubrió gaps graves que dejan al pasajero "a ciegas" ante desenlaces en vivo.

**Lo que el usuario reportó vs. la realidad del código:**

1. *"Al crear la oferta, al pasajero se le abre un componente stock y no el que creamos, pero el
   custom no prioriza enteros."* → El "componente custom" que creamos es **`KeypadModal`** (teclado
   numérico propio del conductor), y su defecto es que **acumula en centavos**
   (`mobile/src/features/driver/presentation/KeypadModal.tsx:53` → escribir "15" = Bs 0.15): es lo
   opuesto a priorizar enteros. El **pasajero nunca tuvo componente custom**: usa `TextInput` stock
   con `decimal-pad` (`ConfigureTripScreen.tsx:312`, `SearchingDriversScreen.tsx:183`).

2. *"El conductor no tiene la contraoferta personalizada en modo mapa."* → Confirmado y aislado:
   `KeypadModal` solo se abre desde la **lista** (`SolicitudesEntrantesScreen.tsx:221` →
   `RequestCard`); el render del mapa (`SolicitudesEntrantesScreen.tsx:161-177`) **no pasa
   `onOpenKeypad`** y `MapCard` no tiene botón lápiz. El mensaje del commit `18dd223` quedó
   desfasado del código.

3. *"Animaciones al contraofertar."* → El envío de oferta hoy tiene **cero feedback animado** (solo
   spinner del botón). `react-native-reanimated@4.3.1` está instalado pero el flujo usa `Animated`
   legacy.

**Gaps graves adicionales (descubiertos):** el pasajero **no tiene toasts** (no existe
`usePassengerToasts`; `(app)/_layout.tsx` no monta `<Toaster>`) y el backend **no le notifica la
expiración** de una oferta (`publish_offer_expired` solo emite al `driver_topic`). Hay también bugs
puntuales: doble `pauseForEdit` al Modificar, `acceptOffer.isPending` que bloquea todas las tarjetas,
cancel sin confirmar en viaje en curso, `resetTrip()` antes de confirmar el cancel, etc.

**Outcome:** un flujo de negociación que se completa sin bloquear a ninguna parte, con feedback en
vivo (WS + toasts) y una entrada de monto única, consistente y "entero-primero" para pasajero y
conductor.

## Decisiones (acordadas con el usuario — no revisar)

1. **Unificar la entrada de monto en un `FareKeypad` reutilizable** (un solo teclado custom) para
   pasajero y conductor; reemplaza el `TextInput` stock de ConfigureTrip/SearchingDrivers y al
   `CounterOfferModal` legacy, y sustituye al `KeypadModal` actual (cuya lógica de centavos se
   rediseña).
2. **Bolivianos por defecto, centavos optativos.** Los dígitos entran como enteros; una tecla `.` activa
   hasta 2 centavos. `15` → Bs 15.00; `15.5` → Bs 15.50. Prioriza enteros.
3. **Alcance: flujo de negociación completo** (todos los gaps listados). NO incluye reanudación de viaje.
4. **Animaciones nuevas con `react-native-reanimated`**; el `Animated` legacy existente
   (`RadarPulse`, `SpinnerRing`, `RippleIcon`, rebote de `ConfirmationOverlay`) queda intacto.

## Hogar del `FareKeypad`

`mobile/src/features/rides/presentation/FareKeypad.tsx` (junto a `OfferLifeTimer.tsx`,
`TripRouteMap.tsx`, `RouteSummary.tsx`, que ya son cross-feature consumidos por `booking` y
`driver`). La **lógica pura entero-primero** va en `mobile/src/features/rides/domain/fareInput.ts`
(dominio sin React, testeable en unidad — cumple la regla "domain sin IO" del `mobile/CLAUDE.md`).
El `Modal` + estilos se reutilizan del `KeypadModal.tsx` actual (mismos `colors/radius/spacing`).

**Modos (2):** `mode: 'absolute'` → display `Bs 15.50` (ConfigureTrip, conductor). `mode: 'increment'`
→ display `+Bs 2.50` (SearchingDrivers). **ETA queda fuera del keypad** (single responsibility): hoy
solo el `CounterOfferModal` lo pedía; el flujo principal del conductor nunca envía ETA y funciona, así
que `OfertaEnviadaScreen.submitCounter` pasa a enviar solo `price`.

---

## Fase 0 — Backend: `offer_expired` al pasajero + limpieza

**Objetivo:** que la expiración de una oferta llegue al `ride_topic` (pasajero), no solo al conductor.
Desbloquea los toasts y la remoción de tarjeta del pasajero (Fase 5). Independiente del mobile.

- `backend/app/api/v1/events.py` — `publish_offer_expired` (114-127): añadir un segundo
  `hub.broadcast(ride_topic(offer.ride_id), …)` con `{offer_id, driver_id, ride_id, reason:"expired"}`
  para que el cliente localice la tarjeta y lea el nombre del conductor de su caché antes de borrarla.
  Estilo: `publish_offer_accepted` (172-215) ya difunde a ride+driver+pool en una sola fn.
- `backend/app/api/v1/routers/rides.py:268` — `asyncio.create_task(_expire_offer_after(...))` sin
  referencia (GC risk). Guardarla en un `set` módulo + `done_callback` que la descarte.
- `backend/app/application/use_cases/withdraw_offer.py:5` y `reject_offer.py` — docstrings stale que
  mencionan `RIDER_ACCEPTED` (estado ya eliminado). Corregir el texto.
- (Opcional, best-effort) barrido periódico de ofertas zombies: anotar; `ExpireOffer`
  (`mark_expired_if_pending`) ya es race-safe y el snapshot del conductor cubre reinicios.

**Validación:** nuevo test en `tests/e2e/test_negotiation_ws.py` (patrón
`test_passenger_receives_snapshot_and_live_offer`): crear ride, conectar WS pasajero, crear oferta,
forzar expiry (monkeypatch `OFFER_TTL≈0.1s` o llamar `ExpireOffer`) y asertar `{type:"offer_expired"}`
en el WS pasajero. `pytest tests/e2e/test_negotiation_ws.py tests/unit/test_offer_use_cases.py` +
`ruff check .`. Ampliar `scripts/smoke_ws.py`.

## Fase 1 — `FareKeypad` reutilizable (fundación, sin integrar)

**Objetivo:** construir el componente y su lógica entero-primero, listo para Fases 2 y 3.

- Crear `mobile/src/features/rides/domain/fareInput.ts` — reducer puro. Estado
  `{intPart, fracPart, decimalActive}`. Acciones `pressDigit/pressDecimal/pressDelete/reset`;
  selectores `toValue(state):number`, `toDisplay(state, mode):string`, `fromValue(n)`.
  Reglas: entero cap 6 dígitos (descarta leading zeros); `.` activa decimal (idempotente); decimal
  cap 2 dígitos; backspace popea frac, luego desactiva decimal, luego popea entero.
- Crear `mobile/src/features/rides/presentation/FareKeypad.tsx` — esqueleto visual clonado de
  `KeypadModal.tsx:149-202` (mismo `styles.backdrop/sheet/grid/key`). Última fila reordenada para
  incluir la tecla `.` (`0 · . · ⌫ · OK`). Props: `{visible, mode:'absolute'|'increment',
  subtitle?, initialValue?, submitting, onCancel, onSubmit:(amountBs:number)=>void}`.
  `canSubmit = value>0 && !submitting`. Reset al remontar vía `key={…}` (patrón existente en
  `SolicitudesEntrantesScreen.tsx:231`).

**Validación:** `fareInput.test.ts` (enteros, centavos, backsize en frontera decimal, maxLength,
leading zeros, `fromValue`/`toValue` redondos). `npx tsc --noEmit && npm run lint`.

## Fase 2 — Conductor: unificar keypad + cablear al mapa

**Objetivo:** un solo keypad en lista, mapa y OfertaEnviada; habilitar contraoferta personalizada
desde el mapa (hoy imposible).

- `mobile/src/features/driver/presentation/SolicitudesEntrantesScreen.tsx` — import `FareKeypad` en
  vez de `KeypadModal` (l.19); el bloque `<KeypadModal/>` (230-237) → `<FareKeypad mode="absolute"
  subtitle={"El pasajero ofrece Bs "+(keypadFor?.fare??0).toFixed(2)} onSubmit={submitKeypad}/>`.
  `submitKeypad` (98-110) sin cambios (ya recibe `price:number`).
  **Cableado al mapa:** en el render de `<SolicitudesMapa>` (161-177) añadir
  `onOpenKeypad={(r)=>setKeypadFor(r)}` (el estado `keypadFor` ya existe, l.66 — no añadir estado).
- `mobile/src/features/driver/presentation/SolicitudesMapa.tsx` — añadir `onOpenKeypad` al `Props`
  (31-48) y al de `MapCard` (221-403); threardearlo en el `renderItem` (178-196). En `MapCard`,
  junto a las pills `+Bs` (328-340), añadir botón lápiz (copiar `pencilBtn` de
  `RequestCard.tsx:417-424`) que llame `onOpenKeypad`.
- `mobile/src/features/driver/presentation/OfertaEnviadaScreen.tsx` — reemplazar `CounterOfferModal`
  (import 28; usos 151-158 y 297-303) por `<FareKeypad mode="absolute" subtitle={…}/>`.
  `submitCounter(price, etaMin)` (91-102) → `submitCounter(price:number)`; `createOffer.mutate` envía
  `{acceptAtFare:false, price}` sin `etaMin`.
- **Eliminar** `KeypadModal.tsx` y `CounterOfferModal.tsx` cuando ya no tengan referencias
  (`grep -r KeypadModal CounterOfferModal src/`).

**Validación:** `tsc --noEmit && npm run lint`. Manual: conductor en modo **mapa** → lápiz → keypad →
enviar → banner "Oferta enviada". Verificar lista y mapa usan el mismo overlay.

## Fase 3 — Pasajero: `FareKeypad` en ConfigureTrip + SearchingDrivers

**Objetivo:** reemplazar los `TextInput` stock del pasajero.

- `mobile/src/features/booking/presentation/ConfigureTripScreen.tsx` — estado `fareKeypadOpen`.
  El `fareRow` con `TextInput` (310-322) → campo tappable que muestra `Bs {fare||'0.00'}` y abre el
  keypad. Montar `<FareKeypad mode="absolute" subtitle="Tu oferta"
  initialValue={fare?Number.parseFloat(fare):undefined}
  onSubmit={(a)=>{setFare(String(a)); setFareKeypadOpen(false);}}/>`. El parser (176) se conserva
  (ahora `fare` siempre viene limpio del keypad). En edición, el efecto de hidratación (96-110) ya
  hace `setFare(String(ride.fare))` → `initialValue` refleja el valor cargado.
- `mobile/src/features/booking/presentation/SearchingDriversScreen.tsx` — el `customRow` con
  `TextInput` (181-201) → botón "+Bs personalizado" que abre `<FareKeypad mode="increment"
  subtitle={currentFare!=null?\`Tu oferta actual: Bs ${currentFare.toFixed(2)}\`:undefined}
  onSubmit={(delta)=>applyIncrease(delta)}/>`.
  **Fix bug `currentFare ?? 0`** (99): deshabilitar pills (162-179) y el botón de monto personalizado
  hasta que cargue `ride.fare` (mostrar spinner/disabled) — hoy un +Bs con `currentFare==null` fija el
  fare absoluto en Bs 2.00.

**Reutilizar:** store `fare:string` (`useBookingStore.ts:21`) sin cambios; `useUpdateRideFare` y
`editRide` siguen recibiendo `number`. Como el teclado del sistema ya no aparece en ConfigureTrip,
revisar si `useKeyboardHeight` (247) sigue siendo necesario (probablemente se pueda quitar).

**Validación:** `tsc --noEmit && npm run lint`. Manual E2E: crear solicitud (absoluto) → buscar →
+Bs (incremento, llega a conductores) → Modificar (absoluto con valor cargado) → guardar.

## Fase 4 — Bugs funcionales del flujo (correcciones puntuales)

Ítems independientes; agrupados porque varios tocan los mismos archivos.

1. **Doble `pauseForEdit`** — `ConfigureTripScreen.tsx:96-110`. Dejar de pausar aquí (el llamador
   `OffersScreen.tsx:137`/`SearchingDriversScreen.tsx:77` ya pausó) y **solo hidratar** el form desde
   `useRide(rideId)` (query ya cacheada por `usePauseForEdit.onSuccess`, `useRideMutations.ts:110`).
   Conservar `didInitEdit` para hidratar una sola vez; quitar el bloque `pauseForEdit.isError` (330-332).
2. **`acceptOffer.isPending` bloquea todas las tarjetas** — `OffersScreen.tsx:238` + `OfferCard`
   336/343. Calcular `acceptingId = acceptOffer.isPending ? acceptOffer.variables ?? null : null` y
   pasarlo; `OfferCard` deshabilita **solo su Aceptar** cuando `offer.id===acceptingId`; **Rechazar**
   queda siempre habilitado.
3. **`TripScreen` sin confirmación** — `TripScreen.tsx:152-158`. Añadir `<ConfirmDialog>` (patrón
   `SearchingDriversScreen.tsx:241-251`); el botón abre el diálogo en vez de mutar directo.
4. **`resetTrip()` antes del éxito del cancel** — `SearchingDriversScreen.tsx:86` y
   `OffersScreen.tsx:146`. Mover `resetTrip()` al `onSuccess` de `cancelRide.mutate` (junto a la
   navegación); en `onError` dejar al usuario en pantalla con el error.
5. **`ConfirmationOverlay` por timeout** — `ConfirmationOverlay.tsx:39`. Avance **por tap**
   (`onPress→onDone`) con mínimo display ~500ms y auto-dismiss de respaldo a 3s; el rebote legacy se
   conserva.
6. **N+1 timers** — `OfferCard` abre su propio `setInterval` (`useCountdown.ts:17`) además del `now`
   global (`OffersScreen.tsx:82-86`). Pasar `now` como prop a `OfferCard` y computar
   `secondsLeft=max(0,ceil((expiresAt-now)/1000))` en vez de `useCountdown(offer.expiresAt)` (278).
7. **Doble fuente de verdad "expirada" (conductor)** — `OfertaEnviadaScreen.tsx:74-75`. Autoridad =
   store WS: `offerExpired = expired.has(rideId)`. El countdown queda solo para display; si llega a 0
   antes que el WS, llamar `markExpired(rideId)` optimista (idempotente).
8. **Estado `taken` no renderizado en cards** — añadir prop `taken` (threardeada desde
   `SolicitudesEntrantesScreen.tsx:57`) y banner "Otro conductor tomó el viaje" en `MapCard` y
   `RequestCard` (bloque visual de `rejectedBanner`, `RequestCard.tsx:359`).
9. **`paused` deja la `MapCard` inerte** — `SolicitudesMapa.tsx:326`. Cuando `paused`, añadir botón
   "Descartar" (dismiss local) dentro del `pausedBanner` existente; mismo affordance en
   `RequestCard.tsx:155`.
10. **(Opcional) Polling vs WS** — `useRides.ts:30`. Gatear `refetchInterval` con un flag
    `wsConnected` del socket para evitar flicker/carga redundante. No bloqueante.

**Validación:** `tsc --noEmit && npm run lint`. Manual: rechazar una tarjeta mientras otra se acepta;
cancelar con red caída (queda en pantalla); tap en el overlay; expiry en OfertaEnviada sin WS.

## Fase 5 — Toasts del pasajero + montaje global

**Depende de:** Fase 0 (`offer_expired` al `ride_topic`).

**Objetivo:** feedback en vivo de los desenlaces de las ofertas al pasajero (hoy silencioso).

- Crear `mobile/src/features/booking/application/usePassengerToasts.ts` — clon de
  `useDriverToasts.ts` (store zustand, `push`/`dismiss`, máx 3). Kinds:
  `'offer_received' | 'offer_expired' | 'offer_withdrawn'`.
- Crear `mobile/src/features/booking/presentation/PassengerToaster.tsx` — clon de `DriverToaster.tsx`
  (mismo `META` icon/color, auto-dismiss 3.5s). En Fase 6 se le añaden entering/exiting.
- `mobile/src/app/(app)/_layout.tsx` — montar `<PassengerToaster />` junto al `<Stack>` (hoy pelado),
  patrón `(driver)/_layout.tsx:13-17`.
- `mobile/src/features/rides/application/useNegotiationSocket.ts` (rama pasajero 27-73) — disparar:
  - `offer_created` (41-50): toast `offer_received` **solo si es oferta nueva** (guarda
    `!prev.some(o=>o.id===offer.id)` — las mejoras reemplazan por id y no deben spamear).
  - `offer_withdrawn` (51-62): si la tarjeta existía, toast `offer_withdrawn`.
  - **Nuevo** `case 'offer_expired'`: filtrar la oferta por `offer_id` de `['ride-offers', rideId]` y
    toast `offer_expired` (leer nombre del conductor de la caché **antes** de removerla).

**Mapeo:** `offer_created`(nueva)→`offer_received`; `offer_expired`→`offer_expired`+remover tarjeta;
`offer_withdrawn`→`offer_withdrawn`; `ride_status(accepted)`→sin toast (lo cubren
`ConfirmationOverlay`+navegación).

**Validación:** `tsc --noEmit && npm run lint`. El smoke ampliado (Fase 0) cubre el evento; asertar
manualmente el toast. Nota: el socket pasajero vive atado a `rideId` dentro de `OffersScreen`
(`OffersScreen.tsx:69`); los toasts se disparan mientras esa pantalla esté montada (coherente con el
modelo driver, donde el pool-socket vive en el layout del conductor).

## Fase 6 — Animaciones con Reanimated (sin romper el legacy)

**Objetivo:** feedback animado al contraofertar y pulir transiciones. `Animated` legacy intacto.

- **Overlay "Oferta enviada" (conductor)** — hoy **cero feedback**. Crear
  `mobile/src/features/driver/presentation/OfferSentOverlay.tsx` (Reanimated, check verde,
  auto-hide ~1.2s, `pointerEvents="none"`) análogo a `ConfirmationOverlay`. Mostrarlo en
  `SolicitudesEntrantesScreen` en los callbacks `acceptAtFare`/`quickAdd`/`submitKeypad` tras
  `markOffered`.
- **Toasts entering/exiting** — `DriverToaster.tsx:35-44` y `PassengerToaster.tsx` (nuevo): cada item
  en `Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)}` y el
  stack con `Layout.duration(200)` para reflujo suave.
- **Banner "Oferta enviada"** — `RequestCard.tsx` (offeredBanner 257-283) y `SolicitudesMapa.tsx`
  (263-281): `Animated.View entering={SlideInDown.duration(200)}`.
- **Aparición de tarjetas nuevas** — `OffersScreen.tsx:233` y upsert `ride_created` del conductor
  (`useNegotiationSocket.ts:90-98`): `LayoutAnimation.configureNext(Presets.easeInAndEaseOut)` al
  detectar nuevo length (más liviano que Reanimated por ítem; caer a `entering={FadeIn}` si flicker
  con maps en Android).
- **Countdown rojo últimos 10s** — `OfferLifeTimer.tsx:21-30`: pulso con
  `withRepeat(withSequence(withTiming(1.06), withTiming(1)))` cuando `low` (mantiene el contract
  presentacional).
- **Transición lista↔mapa** — `SolicitudesEntrantesScreen.tsx:159`: cada rama en
  `Animated.View entering={FadeIn.duration(150)} key={mode}`. Baja prioridad.

**Riesgos:** no mezclar `Animated` legacy y Reanimated en el mismo nodo (transforms conflictivos) —
cada animación nueva va en su propio `Animated.View`. `ReanimatedSwipeable` ya se usa en
`RequestCard.tsx:14`, así que Reanimated ya está bundled en el driver.

**Validación:** `tsc --noEmit && npm run lint`. Manual en emulador: 60fps con lista larga;
regresión visual de `RadarPulse`/`PulseLoader`/`SpinnerRing`.

---

## Secuencia y dependencias

```
Fase 0 (backend) ──► Fase 5 (toasts pasajero, necesita offer_expired)
Fase 1 (FareKeypad) ──► Fase 2 (conductor) ──┐
                     └─► Fase 3 (pasajero)   ─┤
Fase 4 (bugs) — independiente (cuidado solapamiento en Offers/Searching/Configure) ─┤
Fase 6 (animaciones) — al final, sobre Fases 2/3/5 ya estable ──────────────────────┘
```

Orden de ejecución: **0 → 1 → 2 → 3 → 4 → 5 → 6**. Fases 2 y 3 pueden paralelizarse (distintos
archivos salvo `FareKeypad`). Fase 4 conviene tras 2/3 para no resolver conflictos en los mismos
TextInput/overlays.

## Archivos críticos

- `mobile/src/features/rides/presentation/FareKeypad.tsx` (nuevo) +
  `mobile/src/features/rides/domain/fareInput.ts` (lógica entero-primero) — Fase 1
- `backend/app/api/v1/events.py` (`publish_offer_expired` al `ride_topic`) — Fase 0
- `mobile/src/features/rides/application/useNegotiationSocket.ts` (rama pasajero: nuevo
  `offer_expired` + toasts; upsert animado) — Fases 5/6
- `mobile/src/features/booking/presentation/OffersScreen.tsx` (bugs Fase 4 + toasts + animaciones) —
  centro de la decisión del pasajero
- `mobile/src/features/driver/presentation/SolicitudesMapa.tsx` (cableado keypad al mapa, banners
  `taken`/`paused`-descartar) — Fases 2/4
- `mobile/src/features/driver/presentation/SolicitudesEntrantesScreen.tsx` (keypadFor reutilizado,
  overlay de envío) — Fases 2/6
- `mobile/src/features/booking/presentation/ConfigureTripScreen.tsx` +
  `SearchingDriversScreen.tsx` (keypad absoluto/incremento, doble pauseForEdit) — Fases 3/4
- `mobile/src/features/booking/presentation/PassengerToaster.tsx` +
  `application/usePassengerToasts.ts` (nuevos) — Fase 5

## Verificación global (cierre)

- **Backend:** `pytest` (unit + e2e, incl. el nuevo de `offer_expired` al pasajero) + `ruff check .`
  + `python -m scripts.smoke_ws` ampliado.
- **Mobile:** `npx tsc --noEmit` + `npm run lint` tras cada fase.
- **E2E manual con seed (`python -m scripts.seed`):** pasajero crea solicitud (keypad absoluto) →
  conductor oferta desde **lista** y desde **mapa** (lápiz) → pasajero recibe toast de nueva oferta →
  deja expirar (30s): la tarjeta desaparece **con toast** y el conductor ve "expirada" → acepta/rechaza/
  modifica/cancela → verificar toasts de ambos lados, overlay de "oferta enviada" animado, transición
  lista↔mapa con fundido, y que `RadarPulse`/`SpinnerRing` siguen igual.
