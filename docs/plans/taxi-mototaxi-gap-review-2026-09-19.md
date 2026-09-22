# Revisión y corrección de gaps: taxi y mototaxi

Fecha: 19/09/2026. Rama: `codex/ui-improvements-and-bugfixes`, sin commit.
**Estado actual: H01–H05 corregidos y verificados localmente; ETA manual y rutas por servicio implementadas.**
La certificación en dos teléfonos sigue pendiente.

## Ampliación posterior: recogida y experiencia compartida

La **revisión 13** completa la secuencia llegada → «ya salí» → inicio a bordo → cierre
→ calificación. Corrige aceptación con respuesta perdida, oferta vencida en su
confirmación, doble toque en el aviso y snapshots atrasados al reconectar. El aviso
queda guardado y se entrega a ambos participantes; no se interpreta como embarque.

Nueva evidencia: **721 backend**, **311 mobile**, **4 PostgreSQL**, **40 vistas + 16
diálogos**, contrato API/WS y migración `0030`. [Detalle y límites de certificación](../implementation-plans/0013-passenger-driver-pickup-experience.md).

## Resultado de las correcciones

| Hallazgo | Corrección y evidencia |
|---|---|
| H01 · Edición | Consulta el viaje tras perder la respuesta. Si ya se publicó, libera el bloqueo de navegación y recupera ofertas, viaje o cierre según su estado. Si sigue pausado, conserva el formulario. |
| H02 · Finalización | Recupera el detalle terminal. La consulta del conductor resuelve también el cierre pendiente antes de abrir el pool; un fallo de esa lectura conserva el error y no habilita solicitudes nuevas. |
| H03 · Creación | Consulta la solicitud activa al fallar el POST y abre el viaje existente. Sin prueba de guardado mantiene el error y el borrador. |
| H04 · Calificación | Nuevo `GET /api/v1/rides/{ride_id}/rating`: devuelve solo la calificación del participante autenticado para ese viaje. Permite reconocer un guardado aunque se pierda la respuesta; no interpreta cualquier 409 como éxito. |
| H05 · Vehículo | Instantánea de ID, tipo, placa y modelo dentro de la asignación atómica. Detalle, eventos y historial usan esa instantánea. La migración 0029 recupera solo vehículos de viajes activos; los históricos sin evidencia quedan sin datos de vehículo. |
| ETA | Los cinco caminos de oferta/reoferta piden entre 1 y 240 minutos hasta la recogida, sin valor inventado. La duración origen→destino sigue siendo distinta. |
| Rutas | `moto` solicita `TWO_WHEELER`; taxi usa `DRIVE`. Caché separada por servicio y aviso de rutas de moto en pruebas. Un error del proveedor no se sustituye por una ruta de auto. |

### Validación de la corrección

- Backend completo: **717 aprobadas, 80 omitidas** por requisitos optativos; cinco advertencias preexistentes. Tras el ajuste final de persistencia, la suite afectada de API/WS vuelve a pasar: **64 aprobadas**.
- PostgreSQL aislado: **2 pruebas** de migración con taxi/moto y las cinco etapas de viaje; upgrade/downgrade/upgrade verificados. Migración aditiva aplicada a la base local, sin reiniciar servicios.
- Mobile: **303 aprobadas**; TypeScript y lint sin errores. Contrato OpenAPI generado y comprobado en ambos proyectos.
- Pantallas reales, hooks y React Query: **16 casos** (crear, editar, completar, calificar × taxi/moto × fallo antes/después del guardado). No hay cierre falso cuando el servidor no guardó.
- ETA: **10 recorridos** de envío (cinco caminos × dos servicios) y **8 revisiones** de tamaño/tema/texto ampliado. Cancelar no envía una oferta; valores vacíos o fuera de rango no habilitan el envío.
- Google Routes: pruebas del payload por servicio, geometría, fallo sin sustitución por auto y separación de caché. No se certificaron rutas reales del proveedor ni conducción en calle.
- Bundle Android completo: HTTP 200, **11.874.244 bytes**. API y Metro sanos; no equivale a generar un APK actualizado.

Evidencia reproducible local: `local-files/taxi-mototaxi-fixes-2026-09-19/`.
Las pruebas de navegador sustituyen red, mapa y navegación nativa para controlar los fallos. Las pruebas de API, WebSocket y migración se ejecutan por separado. Continúa pendiente probar el dev build en dos teléfonos, incluyendo desconexión, teclado, TalkBack, mapas y contactos nativos.

## Hallazgos originales y reproducción anterior a las correcciones

Las secciones H01–H05 siguientes conservan la descripción y referencias de la auditoría inicial; no describen fallos todavía abiertos.

## Hallazgos priorizados

### H01 · P1 · Guardar una edición puede dejar al pasajero atrapado en el formulario

**Disparador:** el servidor guarda `PATCH /rides/{id}` y vuelve a publicar la
solicitud (`paused=false`), pero la respuesta no llega al móvil.

**Reproducción:** crear → pausar para modificar → guardar → perder la respuesta
HTTP después del commit → volver a consultar el detalle → pulsar Guardar otra vez.
El backend responde 409, «Debes pausar la solicitud antes de editarla». La pantalla
sigue en edición aunque ya conoce `paused=false`. Volver abre «¿Cancelar la
solicitud?»; no existe una salida que continúe esa negociación sin cancelarla.

**Causa:** `ConfigureTripScreen.tsx:371–383` solo navega desde `onSuccess`; el
bloqueo de salida de `:181–183` depende del parámetro `rideId`, no de si el servidor
sigue pausado. El GET posterior hidrata el formulario una sola vez, pero no
reconcilia su etapa.

**Impacto:** se puede cancelar involuntariamente una solicitud ya publicada para
salir de una edición que terminó. Afecta tanto a taxi como a mototaxi.

**Corrección propuesta:** resolver la pantalla desde el estado autoritativo al
recuperar la conexión. Una solicitud publicada debe volver a ofertas; una asignada,
al viaje. Mantener el borrador si el guardado realmente falló.

### H02 · P1 · Una finalización con respuesta perdida omite el cierre del conductor

**Disparador:** WebSocket no disponible y respuesta HTTP perdida después de que
el servidor pasa a `completed`.

**Reproducción:** en el componente real `SolicitudesEntrantesScreen`, finalizar
un viaje `in_progress`, guardar el cambio en el repositorio simulado y rechazar
la respuesta. Resultado: el GET activo devuelve `null`, se muestra «Esperando
nuevas solicitudes» y la calificación no aparece. El servidor conserva un cierre
pendiente y `['pending-rating-ride']` continúa en `null`.

**Causa:** `useTripActions.ts:30–34` invalida detalle y viajes activos, pero no el
pendiente de calificación. El conductor no tiene un observador activo de detalle;
invalidarlo no provoca ese GET. `usePendingRatingRide` no tiene polling, y la
pantalla habilita el pool cuando activo y pendiente son nulos
(`SolicitudesEntrantesScreen.tsx:96–110`).

**Evidencia:** consultas observadas: `active → pending → active → pool`; falta una
segunda consulta de pendientes. El contrato FastAPI real devuelve activo `null`
y el viaje completado en `/rides/me/pending-rating`.

**Corrección propuesta:** reconciliar también el cierre pendiente y mantener la
pantalla de recuperación hasta resolverlo antes de volver al pool. Probar con el
padre y los hooks de consulta reales, además de la tarjeta de viaje.

### H03 · P2 · Una creación con respuesta perdida no recupera la solicitud creada

**Reproducción:** `POST /rides` confirma en servidor, el móvil recibe error de red;
al reintentar, obtiene 409 «Ya tienes una solicitud o un viaje activo». El usuario
permanece en Configurar viaje y no ve las ofertas de su solicitud existente.

**Causa:** `ConfigureTripScreen.tsx:136–148` solo invalida el activo y navega a
ofertas en `onSuccess`. No reconcilia un resultado incierto. La recuperación de
Home se ejecuta al recuperar el foco, no desde el formulario que está encima.

**Impacto:** la solicitud sigue activa y puede recibir ofertas mientras su dueño
cree que no pudo crearla. Volver a Home permite recuperarla, pero repetir Buscar
ofertas no resuelve el error.

**Corrección propuesta:** tras un resultado de creación incierto o conflicto por
activo, consultar el viaje vigente y continuar su etapa; conservar el formulario
solo si se confirma que no se creó una solicitud.

### H04 · P2 · Una calificación guardada puede dejar la tarjeta en error permanente al reintentar

**Reproducción:** enviar cinco estrellas → guardar en servidor → perder respuesta
→ volver a enviar. Resultado real de la API: 409 «Ya calificaste este viaje».
La pantalla sigue abierta; `onDone` nunca se ejecuta.

**Causa:** `useCloseFlow.ts:43–49` actualiza pendientes solo desde `onSuccess`.
`RideRatingCard.tsx:53–66` captura el error sin comprobar si ya existe la
calificación. El viaje detallado no informa la calificación del actor.

**Impacto:** el usuario debe recurrir a Omitir o a salir/reabrir para abandonar un
cierre que ya completó. No duplica la calificación: el backend protege ese caso.

**Corrección propuesta:** añadir reconciliación explícita del cierre o semántica
idempotente compatible. Confirmar la calificación existente antes de cerrar;
no tratar cualquier 409 como éxito.

### H05 · P2 · El vehículo de un viaje anterior cambia al cambiar el vehículo activo

**Reproducción con API real:** registrar taxi `TAXI-123` y moto `MOTO-123` →
completar un viaje en taxi → desconectarse → activar moto → consultar el viaje
y el historial del pasajero. El servicio conserva `taxi`, pero conductor y
contraparte ahora muestran `moto`, `MOTO-123` y el modelo de la moto. Reproducido
también en la dirección inversa.

**Causa:** `GetRide.execute` (`get_ride.py:34–35`) reconstruye el conductor desde
el usuario actual; `RideResponse.from_detail` (`schemas/rides.py:263–272`) usa su
vehículo activo. El historial hace lo mismo en `repositories.py:732–787`.
La asignación no conserva una instantánea de los datos del vehículo utilizado.

**Impacto:** cierre, identificación histórica y soporte muestran un vehículo que
no hizo el viaje. Puede ocurrir antes de que el pasajero abra su calificación.

**Corrección propuesta:** guardar tipo, placa, modelo e identificación del vehículo
al asignar el viaje y consumir esa instantánea en detalle, cierre e historial.
Los viajes históricos sin instantánea requieren una política explícita; no se
puede deducir su vehículo original usando el que está activo ahora.

## Gaps observados en la auditoría inicial

- **ETA de llegada sin fuente en la app.** Los cinco caminos de oferta/reoferta en
  `SolicitudesEntrantesScreen.tsx:172–232` y `OfertaEnviadaScreen.tsx:145–171` envían
  precio y `acceptAtFare`, sin `etaMin`. No hay entrada del conductor ni cálculo
  de conductor a recogida. `TarjetaOferta.tsx:73–75` acaba mostrando «Sin estimación».
  Las pruebas API que proporcionan `eta_min` manualmente no validan esta experiencia.
- **Mototaxi usa la misma ruta que taxi.** `routesService.ts:45–49` fija `DRIVE`,
  y `useRoute.ts:18` comparte caché por coordenadas, sin servicio. No hay
  diferenciación ni certificación de rutas de mototaxi. Esto no demuestra que una
  ruta concreta sea incorrecta; documenta la ausencia de esa capacidad.
- **Seguimiento y operación productiva pendientes:** GPS compartido, segundo
  plano, navegación a recogida/destino, recogida por código, cobro QR comprobable
  y soporte de incidentes siguen fuera del cierre local. Son pendientes ya
  identificados en F04–F09, no implementaciones terminadas por la revisión 11.

## Evidencia de reproducción anterior a la corrección

- **Ocho reproducciones de interfaz:** cuatro escenarios de respuesta perdida ×
  taxi/mototaxi, sin errores JavaScript. Se usaron pantallas reales, React Query,
  `useRides`, `useTripActions`, mutaciones y stores reales. Repositorio HTTP, mapas,
  ubicación y navegación nativa se sustituyeron para controlar el punto de fallo.
- **Cuatro comprobaciones aisladas de API:** creación/edición repetidas y
  cierre/calificación/vehículo histórico, parametrizadas para ambos servicios.
  FastAPI real + SQLite de pruebas. Se verifican respuestas y estados observados;
  que estas reproducciones pasen confirma el fallo, no que el producto esté corregido.
- No se modificaron cuentas, viajes, base local ni procesos de desarrollo en uso.
- Los 289 tests móviles y 60 de API/WS de la entrega anterior no cubrían estas
  combinaciones. El visor previo sustituía `useRides` y no montaba el padre real
  del conductor: por eso no detectó H02. Los tests anteriores de reintento
  modelaban errores antes de guardar, no respuestas perdidas después del commit.
- No se certificaron aquí comportamiento nativo en dos teléfonos, entrega de
  mapas ni carreras PostgreSQL. SQLite no valida bloqueos `FOR UPDATE`.

Evidencia local: `local-files/taxi-mototaxi-gaps-2026-09-19/`.
Incluye `findings.json`, capturas, `browser-tests.log`, `api-tests.log`,
`test_api_contract.py` y el visor/script de reproducción. Los casos de HTTP perdido
simulan la pérdida de respuesta en el límite del repositorio; el contrato que
siguen se comprobó independientemente contra la API.

El orden anterior de corrección ya se ejecutó. Queda la certificación nativa y los pendientes productivos F04–F09 descritos en el plan 0012.


**Continuación, revisión 14:** las pruebas del usuario detectaron un error de
cancelación interna al calificar como conductor y cambios de encuadre entre
servicios. La ETA manual se reemplazó por cálculo automático GPS → recogida.
Ver [corrección, rutas con tráfico y evidencia actual](../implementation-plans/0014-automatic-arrival-and-stable-route.md).
