# Cierre funcional de taxi y mototaxi

Fecha: 19/09/2026. Rama: `codex/ui-improvements-and-bugfixes`.
Estado: cinco fallos de la revisión posterior corregidos y verificados localmente.
ETA manual y rutas distintas para taxi/mototaxi implementadas. Falta la validación en dos teléfonos.

Revisión posterior: [gaps y bugs de taxi/mototaxi](../plans/taxi-mototaxi-gap-review-2026-09-19.md).
Prioridad: recuperación tras respuestas perdidas y conservación del vehículo histórico.
Los cambios permanecen sin commit.

## Alcance de esta entrega

Completar el recorrido actual de pasajero y conductor: elegir servicio y ruta,
proponer precio, negociar y aceptar, recoger, iniciar, finalizar, calificar u
omitir, recuperar el estado y volver a solicitar/ofrecer viajes. El contrato
conserva `taxi` y `moto`; la interfaz denomina al servicio `moto` «Mototaxi».

## Criterios verificados

- [x] Ambos participantes pueden consultar servicio, ruta, precio acordado,
  medio de pago e identificación de la otra parte durante el viaje.
- [x] Llegada, confirmación de inicio y finalización tienen acciones claras;
  tocar varias veces o confirmar un diálogo obsoleto no avanza otra etapa.
- [x] Los fallos de comunicación permiten reintentar y recuperan el estado del
  servidor; fallar al abrir llamada, SMS o compartir tiene respuesta visible.
- [x] Cancelación previa al inicio, finalización, calificación/omisión e historial
  funcionan para taxi y mototaxi. Los cambios de etapa llegan por WebSocket a
  ambos participantes con el mismo contenido que la respuesta HTTP.
- [x] Pantallas revisadas con tamaños pequeños, tema oscuro y texto ampliado;
  TypeScript, lint, regresiones y bundle Android comprobados.

## Cambios

- Resumen compartido de servicio, recogida, destino, tarifa negociada y forma de
  pago. La propuesta conserva su etiqueta mientras la solicitud busca conductor.
- Conductor: acción principal fija, llegada explícita y confirmación de identidad
  del pasajero antes de iniciar. Finalizar requiere confirmar la llegada al destino.
- Los diálogos están asociados al ID y a la etapa del viaje. Las acciones y la
  calificación/omisión tienen un bloqueo inmediato contra envíos repetidos.
- Un fallo HTTP vuelve a consultar el detalle y las vistas activas: si el servidor
  guardó el cambio pero se perdió la respuesta, la app recupera el estado real.
- El pasajero puede volver a las ofertas si recupera una solicitud en búsqueda.
  Cerrar un viaje solo retira su ID de la caché; conserva cualquier otro activo.
- Los errores de llamada, SMS y compartir son visibles. El aviso amarillo de
  llegada mantiene contraste en tema oscuro; datos largos y contactos se ajustan.
- Se distingue la duración estimada de recogida a destino del tiempo de llegada
  ofrecido por el conductor. Ninguno se presenta como seguimiento GPS en vivo.
- El mapa espera tamaño y preparación nativa antes de encuadrar, se actualiza al
  cambiar coordenadas y adapta sus márgenes al panel sin perder toda el área útil.

## Corrección de la revisión posterior

H01–H05 resueltos: recuperar publicación al editar, conservar cierre del conductor,
recuperar creación/calificación y fijar vehículo histórico al aceptar. Se añadió
`GET /rides/{ride_id}/rating` con autorización por participante y la migración
aditiva `0029_ride_vehicle_snapshot`. Los históricos sin evidencia no se rellenan
con el vehículo actual. Se descartan consultas antiguas al guardar o reconocer el cierre.

Los cinco caminos de oferta solicitan ETA manual de recogida entre 1 y 240 minutos.
Las rutas y su caché distinguen taxi (`DRIVE`) de moto (`TWO_WHEELER`); se muestra
el aviso de rutas de moto en pruebas. No equivale a navegación integrada ni GPS compartido.

Evidencia: **717 tests backend**, **2 de migración PostgreSQL**, **303 mobile**,
16 casos de respuesta perdida/no guardada con pantallas y hooks reales, 10 recorridos
de ETA y 8 revisiones visuales del diálogo. TypeScript, lint y OpenAPI aprobados.
Bundle Android final: **11.874.244 bytes**; API y Metro siguen sanos.
Plan y presentación actualizados a **revisión 12**. F04 continúa parcial.

[Detalle de las correcciones, pruebas y límites](../plans/taxi-mototaxi-gap-review-2026-09-19.md).
Evidencia local: `local-files/taxi-mototaxi-fixes-2026-09-19/`.

## Evidencia de la entrega inicial

La revisión posterior encontró escenarios no cubiertos por estas pruebas; sus
resultados no certifican el cierre de los hallazgos H01–H05.

| Comprobación | Resultado |
|---|---|
| `cd backend && .venv/bin/pytest tests/e2e/test_offers_flow_api.py tests/e2e/test_negotiation_ws.py -q` | **60 aprobadas**. Ambos servicios: negociación y asignación, etapas válidas, rechazo de saltos/repeticiones, recuperación por rol, calificación, omisión, historial y eventos de estado WS. Cancelación por pasajero/conductor en `accepted` y `arriving`; rechazo en `in_progress`. |
| `cd backend && .venv/bin/ruff check .` | Aprobado. |
| `cd mobile && npm test` | **289 aprobadas**. Incluye seis regresiones nuevas de encuadre del mapa; las ocho de teléfono pertenecen a la entrega anterior de esta rama. |
| `cd mobile && ./node_modules/.bin/tsc --noEmit` y `npm run lint` | Aprobados. |
| Componentes reales + React Query y mutaciones reales, con repositorio/navegación simulados | Recogida → inicio confirmado → cierre → calificación; cancelación; omisión; reintento de acciones/calificación; respuesta HTTP perdida; diálogo obsoleto; cambio de ID; errores de contacto. Taxi y mototaxi. Sin errores JavaScript. |
| Revisión visual | 24 combinaciones de conductor/pasajero/calificación × 320/390 px × claro/oscuro × texto 100/200 %, y ocho diálogos. Sin desbordamiento horizontal; acciones alcanzables; acción principal fija. Capturas inspeccionadas. |
| Bundle Android de Metro, completo y sin carga diferida | HTTP 200; **11.858.852 bytes**, incluye las acciones y el encuadre definitivos. No equivale a compilar un APK. |
| Servicios locales | API `/health/ready` 200 con PostgreSQL sano; Metro `packager-status:running`. Procesos existentes conservados. |
| Plan y presentación | Revisión 11 sincronizada; F04 continúa parcial y se distingue la base integrada del avance local sin commit. |

La prueba visual usa React Native Web con escala de texto simulada. Sustituye
mapa, APIs de contacto, repositorio y navegación; conserva pantallas, diálogos,
hooks de acciones/mutaciones, React Query y reductores de caché reales. La API y
los WebSockets se prueban por separado con FastAPI y SQLite de pruebas.

Evidencia local excluida de Git: `local-files/taxi-mototaxi-review-2026-09-19/`
(capturas, visor reproducible local, resultados y logs). El visor usa el runtime
Chromium/Playwright disponible en esta máquina; no añade dependencias al producto.

## Validación nativa pendiente

- [ ] En dos teléfonos con el dev build actual: elegir taxi, acordar tarifa,
  confirmar llegada e identidad, iniciar y finalizar; calificar en ambos roles.
- [ ] Repetir con mototaxi, incluyendo contraoferta, cancelación previa al inicio
  y omisión de la calificación. Comprobar historial y nueva solicitud.
- [ ] Cortar/restablecer la conexión, volver a abrir la app y comprobar recuperación;
  revisar mapa nativo, llamadas/SMS, teclado, TalkBack y texto ampliado.

La confirmación de inicio es una comprobación explícita del conductor; no sustituye
una futura verificación de recogida por código. Un viaje finalizado tampoco acredita
un cobro. GPS compartido, segundo plano, Navigation SDK, QR conciliado y certificación
productiva conservan los criterios independientes de F04–F09 del plan de salida.
No se modifica la gracia de presencia de 120 s ni la expiración de ofertas de 30 s.


## Continuación: experiencia compartida de recogida

La revisión 13 añade aviso persistente «Ya salí», confirmación de oferta, progreso
compartido y recuperación ante snapshots atrasados. La evidencia vigente del
recorrido ampliado está en el [plan 0013](0013-passenger-driver-pickup-experience.md).
La certificación nativa en dos teléfonos y el cierre productivo F04 siguen pendientes.
