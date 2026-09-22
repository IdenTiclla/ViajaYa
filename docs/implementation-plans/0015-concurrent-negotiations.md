# Negociaciones simultáneas

19/09/2026 · Implementado y verificado localmente · `codex/ui-improvements-and-bugfixes`.

El conductor debe poder ofertar a varias solicitudes y el pasajero comparar varios
conductores en su solicitud. Cada oferta vence a los 30 segundos. La primera
aceptación válida asigna un solo viaje al conductor, retira sus demás ofertas y
conserva las negociaciones de los otros conductores con los otros pasajeros.
No se amplía la regla de un viaje activo por participante.

## Cambios y criterios de cierre

- Envío/ETA independiente por solicitud, sin modal que bloquee el resto del pool.
  Doble toque sobre el mismo pasajero no duplica el envío; respuestas fuera de
  orden conservan sus callbacks y errores. Reintentar una no reenvía las demás.
- Contador de ofertas en espera, acceso directo a cada oferta y acción explícita
  para seguir viendo solicitudes sin retirar la propuesta.
- Una aceptación en cualquier negociación abre el viaje asignado, aunque se esté
  consultando otra oferta. El backend mantiene la asignación atómica existente.
- Verificar API/WS con varios pasajeros y conductores, reconexión y retirada de
  las ofertas del ganador. Verificar concurrencia real en PostgreSQL desechable.
- Probar tarjetas/pantallas reales con envíos solapados, errores independientes,
  retorno al pool y aceptación de otra negociación; TypeScript, lint y bundle.
- Actualizar el plan y la presentación con evidencia, separando pruebas locales
  de la validación pendiente en teléfonos físicos.


## Resultado y evidencia

- El backend ya admitía múltiples ofertas; se conserva el contrato y su asignación
  atómica. No hubo cambios de esquema ni de lógica backend para esta entrega.
- Se elimina el modal de ETA/envío. Cada tarjeta tiene su estado pendiente y los
  errores se identifican por pasajero, con reintento independiente. El estado de
  las mutaciones sobrevive al cambio entre lista y detalle. La confirmación de
  envío es ahora un aviso compacto que no oscurece ni captura toques.
- La lista muestra cuántas ofertas siguen esperando y permite abrir «Ver oferta»
  directamente. «Seguir viendo solicitudes» conserva la propuesta. La aceptación
  de otra negociación abre inmediatamente el viaje que se asignó.
- **334 pruebas móviles aprobadas**, incluidos cinco casos nuevos: respuestas en
  orden inverso, doble toque por solicitud, error/reintento independiente, errores
  separados y envío pendiente de una pantalla anterior. TypeScript y lint limpios.
- **62 pruebas API/WS aprobadas**. Los dos casos nuevos (taxi/moto) conectan tres
  pasajeros y dos conductores, crean seis ofertas, recuperan las tres ofertas de
  un conductor al reconectar y verifican retirada selectiva, rechazo de aceptación
  atrasada y bloqueo de ofertas del conductor ocupado. Otro pasajero todavía puede
  aceptar al segundo conductor. Tres advertencias ya existentes en esta suite.
- **4 pruebas PostgreSQL aprobadas** en una base nueva desechable: dos pasajeros
  aceptando al mismo conductor, dos conductores para el mismo pasajero, dos ofertas
  simultáneas para el mismo par e índice que impide duplicar viajes activos.
  La base de desarrollo no se modifica; la base temporal se elimina al terminar.
- **17 casos de UI aprobados**: tres envíos solapados y respuestas invertidas;
  volver sin retirar; aceptación de otra negociación; reintento/retirada aislados;
  navegación durante un envío; comparación de conductores por el pasajero y
  carrusel del mapa. Se repiten en taxi/moto y se añade pantalla 320×640, tema
  oscuro y texto 200 %. Sin errores JavaScript ni desbordamiento horizontal.
- **Android:** bundle HTTP 200, **11.896.851 bytes**, con el nuevo código de
  concurrencia. API y Metro sanos; sin reiniciar procesos ni levantar emulador.
- **Plan/presentación:** revisión 15, 32 diapositivas. Navegación, lectura, descarga
  idéntica al plan, impresión y tamaños escritorio/móvil aprobados; sin errores
  JavaScript ni desbordamientos.

Evidencia local: `local-files/concurrent-negotiations-2026-09-19/`.
El visor usa pantallas, tarjetas, hooks, React Query y estado reales; sustituye
GPS, HTTP, navegación, mapa nativo y gesto de deslizar. API/WS y PostgreSQL tienen
pruebas independientes. Falta validar esta versión en dos teléfonos reales,
incluidas red móvil, GPS y render nativo del mapa. No se declara salida a producción.
