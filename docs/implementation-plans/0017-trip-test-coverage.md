# Cobertura adicional de negociación y acciones del viaje

19/09/2026 · Rama `codex/ui-improvements-and-bugfixes`.

Se añaden **31 casos automatizados** a los planes 0012–0016: 23 móviles,
6 de integración HTTP/WebSocket y 2 de concurrencia PostgreSQL. Se mantienen
los casos anteriores; la cantidad de pruebas no es un porcentaje de cobertura
de líneas o ramas.

## Casos añadidos

| Suite | Casos | Comportamiento protegido |
|---|---:|---|
| `mobile/tests/tripActions.test.mjs` | 23 | Transiciones, cancelación por etapa, pulsaciones repetidas, exclusión entre acciones, respuesta perdida y reintento, callbacks atrasados, aviso de recogida, errores de llamada/mensaje y datos compartidos de taxi/moto |
| `backend/tests/e2e/test_offer_version_contract.py` | 4 | Taxi/moto y aceptar tarifa/contraofertar: versiones inválidas devuelven 422/409, conservan la oferta vigente y no producen eventos de reemplazo; versión omitida o nula mantiene compatibilidad |
| `backend/tests/e2e/test_negotiation_ws.py` | 2 | Tres pasajeros y dos conductores, seis negociaciones por v2, eventos con versión consecutiva, desconexión durante asignación y recuperación de las ofertas restantes para ambos roles |
| `backend/tests/postgresql/test_pg_concurrency.py` | 2 | Dos conductores ofertan a ambos pasajeros y ganan viajes diferentes simultáneamente, sin bloquearse entre sí y retirando solo las ofertas competidoras |

## Regresión detectada y corregida

Cinco casos fallaron inicialmente: el hook `useTripActions` comprobaba el viaje y
el estado de una renderización anterior cuando se conservaba su callback. Las
pantallas ya tenían controles para ocultar confirmaciones obsoletas, pero el hook
no garantizaba por sí mismo el rechazo de esas llamadas atrasadas.

Ahora vuelve a comprobar la identidad, etapa y operación pendiente del último
render confirmado antes de enviar. También evita repetir el aviso de recogida si
el reconocimiento ya llegó por WebSocket. Las 23 pruebas del hook pasan después
del cambio, incluidas las cinco regresiones.

Las pruebas móviles ejecutan el hook original con estado/ref conservados entre
renders y promesas controladas. Sustituyen React, los hooks de mutación y las APIs
nativas: verifican decisiones y efectos del hook, no certifican el ciclo nativo
de React, GPS, teléfono ni SMS. Las pruebas v2 usan FastAPI, outbox y sockets reales
con SQLite temporal; las carreras se comprueban por separado en PostgreSQL.

## Reproducción

Desde `mobile/`: `npm test`, `npx tsc --noEmit`, `npm run lint`.

Desde `backend/`: `.venv/bin/pytest -q`, `.venv/bin/ruff check .`.
Para PostgreSQL, establecer `VIAJAYA_TEST_DATABASE_URL` apuntando exclusivamente a
una base desechable cuyo nombre empiece por `test_`; después ejecutar
`.venv/bin/pytest -q tests/postgresql/test_pg_concurrency.py`.
El fixture recrea su esquema. La verificación de esta revisión crea una base
nueva y la elimina al finalizar; no migra ni limpia la base de desarrollo.

## Resultados verificados

- Mobile: **367 aprobadas**, frente a 344 anteriores; TypeScript y lint limpios.
- Backend: **731 aprobadas**, frente a 725 anteriores; 90 omitidas por configuración
  opt-in y cinco advertencias preexistentes. Ruff limpio.
- PostgreSQL: **9 aprobadas**, frente a 7 anteriores, en una base nueva desechable
  eliminada al terminar. Estas pruebas requieren una ejecución separada de la suite
  estándar; no se suman como nuevas las siete que ya existían.
- UI: **27 casos existentes aprobados de nuevo** con el bundle del código actual.
  Pantallas/hooks reales y servicios nativos simulados; sin errores JavaScript.
- Plan y presentación actualizados a revisión 17. Se conserva como histórica la
  verificación de OpenAPI y del bundle Android de la revisión 16; no hubo cambios
  en contratos HTTP, WebSocket ni esquema PostgreSQL en esta entrega.
- Presentación: 32 diapositivas verificadas, navegación/lectura/impresión y descarga
  idéntica al plan, sin desbordamientos en escritorio/móvil ni errores JavaScript.

Evidencia local: `local-files/test-coverage-2026-09-19/`. El recorrido en dos
teléfonos con GPS y red reales sigue pendiente; las pruebas locales no cierran F09.
