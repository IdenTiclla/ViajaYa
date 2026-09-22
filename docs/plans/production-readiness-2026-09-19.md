# Revisión de avance y preparación para producción — 19/09/2026

## Alcance y conclusión

Revisión del código versionado de `main`, commit `986dd79` (merge del PR #15 del
14/09), los planes activos y las comprobaciones locales indicadas abajo. El núcleo
del viaje y la identidad tienen una implementación amplia; el servicio comercial
todavía requiere desarrollo, integración con proveedores y certificación operativa.
El [plan de salida](plan-salida-produccion.md) queda actualizado a la revisión 10.

No se cambiaron funciones de la app/API, configuraciones secretas, datos ni servicios.
Los directorios preexistentes sin seguimiento `agent-harness-framework/`,
`done-sin-renders/` y `ui-redesign-flow/` no se incluyeron en la evaluación del
producto versionado. No se hicieron commits ni pushes en esta revisión.

## Evidencia actual frente a antecedentes

| Área | Evidencia revisada | Conclusión y límite |
|---|---|---|
| Entornos | `backend/app/infrastructure/environment.py`, `mobile/eas.json`, `ops/compose.hosted.yml`, plan 0009 | Configuración y variantes implementadas. Instalaciones y túnel son evidencia histórica; no se certificó disponibilidad actual ni alojamiento permanente. |
| Teléfono/sesión/social | `backend/app/api/v1/routers/account_access.py`, `phone_verification.py`, casos de uso de acceso y tests HTTP/WS | Implementados con OTP simulado en entornos bajos. Google real en Desarrollo consta en el plan 0010 del 13/09; el candidato actual de Pruebas sigue sin recorrido documentado. |
| SMS productivo | `backend/app/api/deps.py`, `backend/app/application/use_cases/request_phone_code.py` | La solicitud exige `mock_enabled`; en producción se rechaza con indisponibilidad. No existe un adaptador real conectado que permita cerrar F02-C. |
| Recuperación | `request_account_recovery.py`, `review_account_recovery.py`, `mobile/src/features/auth/application/phoneAccessController.ts`, `PhoneEntryScreen.tsx` | Existe lógica y contrato; la pantalla única actual no presenta la solicitud. Falta recorrido visible y herramienta de operador F03-B. |
| Conductores | `register_driver_vehicle.py`, `switch_account_mode.py`, migraciones `0027`/`0028`, feature móvil `driver` | Alta, varios vehículos, servicios y modo activo implementados. Documentos y gestión administrativa siguen pendientes. |
| Territorio | `backend/app/domain/value_objects.py`, `schemas/rides.py`, `get_driver_earnings.py`, `mobile/src/features/rides/domain/money.ts` | Bolivia, moneda/formato y horario permanecen fijos. El plan 0011 no es implementación; se corrigieron sus números de migración propuestos. |
| Tiempo real | Outbox, Redis, scheduler, contratos y plan 0008 | Implementación y antecedentes de integración local. Faltan rollout representativo, monitoreo con destinatario real y certificación de carga del candidato. |
| GPS/mapas/navegación | Features `home`/`booking`/`rides`, rutas HTTP, contrato WS y `mobile/package.json` | Hay posición del dispositivo, mapas y rutas. No se encontró circuito completo de GPS conductor→pasajero, push ni dependencia de Navigation SDK. |
| Pagos | Rutas y entidades backend; `mobile/src/app/(app)/(tabs)/wallet.tsx` | `qr`/`cash` son opciones del viaje; la billetera es un placeholder. No hay evidencia del circuito de cobro, comisión, conciliación y liquidación. |
| Encomiendas/mudanzas | Tipos `delivery`/`moving` y compatibilidad de servicios por vehículo | Tipos soportados en el viaje; no certifican destinatario/paquete/entrega ni operación comercial de mudanzas. |
| CI/despliegue | `.github/workflows/ci.yml`, Dockerfile, scripts operativos y monitoreo | Definiciones versionadas. Merge confirmado en Git local; estado remoto de Actions, nube y Google Play no consultados. |

Las rutas abreviadas de casos de uso corresponden a
`backend/app/application/use_cases/`. La revisión no constituye una auditoría
exhaustiva de seguridad ni una medición de capacidad.

## Comprobaciones ejecutadas el 19/09

| Comprobación | Resultado |
|---|---|
| Backend: `.venv/bin/pytest tests/unit tests/e2e -q` | **700 aprobadas**, 5 advertencias; 36,14 s. |
| Backend: `.venv/bin/ruff check .` | Aprobado. |
| Backend: `.venv/bin/python -m scripts.export_openapi --check` | Snapshot vigente. |
| Backend: `.venv/bin/python -m scripts.export_realtime_contract --check` | Contrato vigente. |
| Raíz: `npm run openapi:check` | Tipos móviles vigentes. |
| Mobile: `npm test` | **275 aprobadas**, cero fallos y cero omitidas. |
| Mobile: `./node_modules/.bin/tsc --noEmit` | Aprobado. |
| Mobile: `EXPO_NO_DOTENV=1 npm run lint` | Aprobado. |

Las advertencias backend incluyen dos deprecaciones de Starlette/AnyIO y tres
helpers importados como `test_settings` que pytest cuenta como pruebas aunque
devuelven configuración. El total de 700 es el informado por pytest, no una
medida de cobertura funcional. Corregir esa recolección es mantenimiento pendiente.

El sandbox bloqueó la primera ejecución backend al inicializar SQLite async y
limitó el detalle de los procesos móviles. Ambas suites se repitieron fuera de
ese aislamiento, mediante escalación aprobada automáticamente, con los resultados
anteriores. Un ensayo diagnóstico móvil con `--test-isolation=none` produjo un
fallo de contrato HTTP; no es el comando configurado por el proyecto. La ejecución
normal con aislamiento por archivo pasó sus 275 casos; no se modificaron pruebas
para conseguir el resultado.

Logs de trabajo locales (temporales, no necesarios para usar el plan):

- `/tmp/viajaya-production-review-backend-tests.log`.
- `/tmp/viajaya-production-review-mobile-tests.log`.
- `/tmp/viajaya-production-review-mobile-lint.log`.

## Comprobaciones que siguen pendientes

- PostgreSQL/Redis opt-in, migraciones y carreras reales sobre una base desechable
  del candidato actual. El plan 0010 conserva antecedentes de esas pruebas; no
  se trasladan automáticamente a esta versión.
- Ejecución remota completa de CI asociada al commit candidato.
- API/HTTPS/WSS de Pruebas, migraciones desplegadas, APK vigente y recorrido con
  dos teléfonos; acceso social, sesión, cambio de número y recuperación.
- GPS/segundo plano/push/navegación, cobro QR/efectivo con contabilidad y encomienda
  completa, después de implementar sus bloques.
- Carga de 500 conductores, hipótesis de pasajeros concurrentes, latencias,
  restauración, alertas reales, rollback y costos observados.
- SMS real, credenciales productivas, condiciones comerciales, privacidad,
  eliminación de cuenta y distribución por Google Play.

## Correcciones al plan

- F01 y F02 ya están integradas en Git; se retiró el estado obsoleto «sin publicar».
- F04 pasa a avance parcial explícito por alta/vehículos/modos; no se marca cerrada.
- HTTPS y APK inicial de F02-B se reconocen como antecedentes completados; la
  actualización y certificación de Pruebas siguen abiertas.
- Se distingue recuperación implementada en lógica de recuperación accesible en
  la pantalla y resuelta por soporte.
- F03-A conserva su alcance acordado y se planifica después de la migración
  `0028`. F03-B/C siguen pospuestas, pero son necesarias para la apertura.
- Facebook continúa aplazado. Mudanzas existe parcialmente en código; no se
  añade por inferencia al lanzamiento acordado de taxi, moto y encomiendas.
- Se mantiene un calendario por hitos, sin inventar fecha, responsables,
  presupuesto aprobado ni porcentaje global de avance.
- La presentación HTML se actualizó también a la revisión 10 por solicitud del
  usuario. Conserva 32 diapositivas; su vista completa y descarga incorporan el
  Markdown vigente.

## Referencias externas revisadas

Estas consultas actualizan referencias de planificación; no acreditan cuentas,
contratos ni disponibilidad del proyecto en los proveedores.

- [Google Maps: lista de precios](https://developers.google.com/maps/billing-and-pricing/pricing)
  y [facturación de Navigation SDK](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing):
  se conservan los escenarios de consumo del plan; no son una cotización del piloto.
- [Render: regiones](https://render.com/docs/regions): el catálogo consultado no
  incluye Sudamérica; la selección sigue condicionada a medir latencia en Bolivia.
  Las bandas propias de infraestructura requieren cotización detallada.
- [Twilio Verify](https://www.twilio.com/en-us/verify/pricing) y
  [EAS](https://expo.dev/pricing): las referencias de USD 0,05 por verificación
  más canal y Starter de USD 19/mes más consumo siguen publicadas; no se eligió
  un proveedor ni se contrataron servicios.
- [Google Play: pruebas de cuentas personales](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB):
  verificar aplicabilidad al titular; las cuentas personales creadas después del
  13/11/2023 tienen requisito de 12 testers durante 14 días continuos.
- [Google Play: eliminación de cuentas](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN):
  conservar en F09 la solicitud desde la app y una vía web accesible.


## Continuación: negociaciones simultáneas (revisión 15)

El plan [0015](../implementation-plans/0015-concurrent-negotiations.md) documenta
el envío independiente por pasajero, recuperación al navegar y apertura del viaje
asignado desde otra negociación. Verificado: 334 pruebas mobile, 62 API/WS,
4 PostgreSQL y 17 casos UI. Bundle Android actualizado, API/Metro sanos.
No modifica los cierres productivos pendientes ni atribuye la suite completa del
backend de las revisiones anteriores a esta ejecución. Falta el recorrido en teléfonos.


## Continuación: auditoría de negociaciones (revisión 16)

El [plan 0016](../implementation-plans/0016-negotiation-race-audit.md) documenta
cuatro bugs reproducidos y corregidos: eventos antiguos que ocultan mejoras,
respuestas de otro viaje que pisan el activo, solicitudes fuera de la primera
página y ETA asociada a una recogida que cambió durante el cálculo.
Verificado: 344 pruebas mobile, 725 backend (88 omitidas, cinco advertencias),
7 PostgreSQL y 27 casos UI. OpenAPI/tipos sincronizados, bundle Android actualizado,
API y Metro sanos. Sin migración de la base ni commits. Falta el recorrido en teléfonos.
