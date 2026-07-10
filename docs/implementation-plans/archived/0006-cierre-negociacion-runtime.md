# Plan 0006 — Cierre del flujo de negociación: bugs de runtime y pulido de UX

> **Contexto:** el plan 0005 quedó implementado por completo (FareKeypad unificado, toasts de
> ambos lados, `offer_expired` al pasajero, animaciones Reanimated) con `tsc`/`lint`/`pytest`
> verdes, pero **sin probar en runtime**. Esta exploración de cierre encontró bugs que solo se
> manifiestan en ejecución (estado interno de componentes, carreras de expiración, desenlaces
> llegados por WS). **Creado:** 2026-07-01.

## Bugs encontrados y su corrección

### 1. `FareKeypad` no se resincroniza al reabrirse (todas las pantallas)

El estado del teclado se inicializa **solo al montar** (`useState(() => fromValue(initialValue))`,
`FareKeypad.tsx:50`) y el componente vive montado con `visible=false`. Consecuencias:

- **ConfigureTrip (Modificar solicitud):** la hidratación del form (`setFare(String(ride.fare))`)
  corre después del montaje → al abrir el teclado muestra el monto con el que montó (viejo si el
  pasajero aumentó la oferta con `+Bs` durante la búsqueda), no el vigente.
- **Todas:** si el usuario escribe y **cancela**, al reabrir ve la entrada descartada en vez de
  empezar limpio / con el valor actual.

**Fix (central):** en `FareKeypad`, resetear el estado desde `initialValue` cada vez que `visible`
pasa de false → true (ref `wasVisible` + efecto). Con esto el `key={keypadFor?.id ?? 'none'}` de
`SolicitudesEntrantesScreen` sobra (se quita: un solo mecanismo).

### 2. Pasajero atascado si la última oferta expira durante el overlay de confirmación

En `OffersScreen`, si la oferta aceptada era la única visible y su `expiresAt` vence mientras se
muestra `ConfirmationOverlay` (`confirming=true`), el render cae en
`visibleOffers.length === 0` → monta `SearchingDriversScreen`, **desmonta el overlay** y
`handleConfirmed` nunca corre; el efecto de respaldo exige `!confirming` → el pasajero queda en
"Buscando ofertas…" con el viaje ya asignado.

**Fix:** no cambiar a la pantalla de búsqueda mientras `confirming`
(`visibleOffers.length === 0 && !confirming`).

### 3. Viaje cancelado "desde fuera" = búsqueda infinita

Si `ride.status` pasa a `cancelled` por WS/polling sin que esta pantalla lo iniciara (canceló en
otro dispositivo/sesión), `assigned=false` y `OffersScreen` muestra `SearchingDriversScreen` para
siempre, y sigue consultando `/offers` de un viaje muerto.

**Fix:** efecto en `OffersScreen`: al detectar `cancelled` (sin mutación local en vuelo y sin
`confirming`), `resetTrip()` + volver al inicio. Además `useRideOffers` se deshabilita también
cuando el viaje está cancelado.

### 4. Toasts confusos cuando el conductor mejora su oferta

`publish_offer_superseded` emite `offer_withdrawn` (la vieja) + `offer_created` (la nueva). El
pasajero ve **dos toasts**: "Juan retiró su oferta" seguido de "Nueva oferta – Juan": ruido y
además falso (no la retiró, la mejoró).

**Fix:** el backend añade `reason: "superseded"` al `OFFER_WITHDRAWN` de la mejora
(`events.py`); el cliente quita la tarjeta **sin toast** cuando `reason === 'superseded'` (el
`offer_created` siguiente ya anuncia el monto nuevo). Test e2e: asertar el `reason` en el evento
de supersede (`test_negotiation_ws.py`).

### 5. Código muerto: `useKeyboardHeight` en ConfigureTrip

Ya no queda ningún `TextInput` (el monto se ingresa con el keypad): el teclado del sistema nunca
aparece y el hook quedó muerto. Se elimina (previsto como revisión en 0005/Fase 3).

## Verificación

- **Estática:** `npx tsc --noEmit` + `npm run lint` (mobile); `ruff check .` + `pytest` (backend,
  incluye el assert nuevo de `superseded`).
- **Runtime (backend real):** `docker compose up -d db` → `alembic upgrade head` → `uvicorn` →
  `python -m scripts.seed` → `python -m scripts.smoke_ws` (pasajero y conductor reales por
  HTTP+WS: solicitud → visible en pool → limpieza).
- **Manual (pendiente en emulador):** flujo E2E de negociación con dos cuentas del seed; los
  puntos de este plan cubren precisamente lo que la verificación estática no puede ver.

## Archivos críticos

- `mobile/src/features/rides/presentation/FareKeypad.tsx` — resync al abrir (bug 1)
- `mobile/src/features/booking/presentation/OffersScreen.tsx` — bugs 2 y 3
- `mobile/src/features/rides/application/useNegotiationSocket.ts` — `superseded` sin toast (bug 4)
- `backend/app/api/v1/events.py` + `tests/e2e/test_negotiation_ws.py` — `reason` de supersede
- `mobile/src/features/booking/presentation/ConfigureTripScreen.tsx` — limpieza (bug 5)
- `mobile/src/features/driver/presentation/SolicitudesEntrantesScreen.tsx` — quitar `key` del keypad
