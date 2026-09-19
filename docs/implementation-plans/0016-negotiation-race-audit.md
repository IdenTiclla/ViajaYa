# Auditoría de carreras y recuperación de negociaciones

19/09/2026 · Implementado y verificado localmente · `codex/ui-improvements-and-bugfixes`.

Continuación del plan 0015. Revisar y corregir problemas reproducibles de taxi/moto:

1. La expiración o el rechazo de una oferta anterior invalida una mejora que sigue
   en vuelo. Los eventos exactos deben retirar solo su `offer_id`; los terminales
   del viaje y las pausas conservan sus barreras.
2. Una respuesta HTTP de un viaje anterior puede sobreescribir otro viaje activo.
   El estado activo debe mantener la identidad además de avanzar de estado.
3. La pantalla de oferta busca solo en las páginas cargadas y declara que el viaje
   no está disponible aunque la solicitud vigente esté en una página posterior.
4. Cambiar la recogida durante GPS/cálculo permite ofertar con ETA de otro origen.
   Mobile enviará `expected_pool_version`; el backend revalidará la versión bajo
   el bloqueo existente antes de crear/reemplazar la oferta. Campo opcional para
   compatibilidad con clientes anteriores; sin migración de base de datos.

Guardar reproducciones antes del cambio, añadir regresiones, validar el contrato
HTTP en ambos lados, UI real con adaptadores de hardware y carreras PostgreSQL.
Actualizar el plan y la presentación sin certificar el recorrido en teléfonos.


## Reproducciones y correcciones

- **H16-01 · Mejora invisible:** `markExpired` y el rechazo con `offer_id` retiraban
  el intento entero del ride. Ahora conservan el intento en vuelo y registran solo
  el ID finalizado. Cuatro regresiones cubren ambos eventos con/sin oferta anterior
  visible; siguen pasando las pruebas que impiden resucitar la misma oferta vencida,
  una pausa, un viaje asignado o una respuesta HTTP anterior.
- **H16-02 · Viaje activo sustituido:** una respuesta de otro ride podía pasar la
  comparación de estado y reemplazar el activo. `applyRideMutationResult` rechaza
  ese resultado cuando hay otro viaje activo no terminal. Verificado para ambos roles.
- **H16-03 · Falso viaje no disponible:** el visor mostraba ese mensaje sin consultar
  la segunda página. `useNegotiationRide` avanza páginas hasta encontrar la solicitud
  o agotar el pool, mantiene recuperación durante la lectura y reintenta la página
  que falló sin entrar en un bucle automático. Cuatro pruebas del hook y cuatro
  casos de UI cubren recuperación y error/reintento en taxi y moto.
- **H16-04 · ETA para otra recogida:** el backend aceptaba con HTTP 201 una oferta
  cuya recogida se había movido mientras se calculaba ETA. Ahora el cliente envía
  `expected_pool_version`; el caso de uso compara la versión vista por el conductor
  y el repositorio la revalida bajo el lock de la solicitud. Un 409 actualiza el pool
  y exige revisar la solicitud; no ofrece reintentar automáticamente los datos viejos.
  El siguiente envío calcula ETA para las coordenadas y versión actualizadas.
  Contrato opcional compatible, OpenAPI y tipos generados sincronizados; sin migración.

## Verificación del 19/09/2026

- Las reproducciones previas fallaron: seis aserciones del reducer, dos pruebas API
  con `201 != 409` y dos pantallas con «Viaje ya no disponible» sin pedir otra página.
- **344 pruebas móviles aprobadas**, TypeScript y lint limpios.
- **725 pruebas backend aprobadas**, 88 omitidas por configuración opt-in y cinco
  advertencias existentes. Ruff y verificación de OpenAPI aprobados.
- **7 pruebas PostgreSQL aprobadas** en base nueva desechable. Incluyen dos casos
  nuevos (taxi/moto) que mantienen una edición sin confirmar, comprueban que la
  creación espera el lock y que después rechaza la versión antigua sin crear ni
  reemplazar ofertas. La base se elimina al finalizar; no se migra la base de desarrollo.
- **27 casos UI aprobados:** los 17 de negociación simultánea, seis sobre eventos
  de ofertas anteriores/cambio de recogida y cuatro de paginación/error/reintento.
  Pantallas y hooks reales; red, GPS, mapa y navegación nativos sustituidos por
  adaptadores. Sin errores JavaScript en los visores.
- **API y Metro sanos**. El OpenAPI del servidor en ejecución contiene el nuevo
  campo; bundle Android HTTP 200, **11.899.258 bytes**, con control de versión.
- Plan y presentación actualizados a **revisión 16**, con 32 diapositivas verificadas:
  navegación, lectura, descarga idéntica al plan, impresión y tamaños escritorio/móvil
  sin desbordamientos ni errores JavaScript. Continúa pendiente el recorrido
  de esta versión en teléfonos reales; estas pruebas no certifican producción.

Evidencia reproducible: `local-files/negotiation-bug-audit-2026-09-19/`, incluidas
las salidas previas a la corrección, suites, visor y carrera PostgreSQL aislada.
