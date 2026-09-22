# F01 — Base técnica y tres entornos

Fecha inicial: 2026-09-09. Actualización de estado: 2026-09-19. Rama original: `codex/phase-01-environments`; integrada en `main` mediante el PR #15 (`986dd79`, 14/09).

Estado: **F01 completada y verificada localmente**, con evidencia histórica de APK de Desarrollo y Pruebas compilados y firmados en EAS. Pruebas se configuró temporalmente en esta PC con HTTPS; su disponibilidad actual y el alojamiento permanente no se certificaron en la revisión del 19/09. F02 ya tiene implementación y conserva cierres pendientes. Estado vigente: [plan de producción](../plans/plan-salida-produccion.md).

## Entregas

- [x] F01-A: contrato `APP_ENV=development|testing|production`, configuración validada, ejemplos y protección contra modos de proveedor incorrectos.
- [x] F01-B: identidades Android/iOS y enlaces separados, variables públicas por entorno, configuración de runtime validada y distintivo en entornos bajos.
- [x] F01-C: `uv.lock`, zonas horarias portables, Dockerfile fijado, proceso de migración separado, definición de despliegue y CI ampliada.
- [x] Preferencia persistente: código/identificadores/comentarios nuevos en inglés, interfaz y documentación para el usuario en español; verificar cada implementación.

## Decisiones

- Pruebas se identifica técnicamente como `testing`; EAS conserva su perfil/entorno `preview`. Su aplicación usa `com.viajaya.app.testing`.
- Los tokens nuevos exigen emisor y audiencia específicos. Tokens anteriores sin esos campos requieren iniciar sesión nuevamente; se conserva la cuenta y el historial.
- Las claves de emisor/audiencia, Redis y almacenamiento se validan por entorno; los recursos físicos separados se aprovisionan/certifican en F09.
- El servidor y la compilación móvil rechazan OTP de prueba en producción. Los desafíos y la pantalla de autofill pertenecen a F02; no se presentan como implementados aquí.
- El bundle móvil contiene solo configuración pública. OTA queda deshabilitado hasta certificar su mecanismo de entrega en F09.
- La verificación local usa `.venv-f01` y contenedores desechables, sin sustituir el entorno virtual del backend existente ni reiniciar sus contenedores.

## Evidencia

- Backend: **649 pruebas aprobadas**, incluidas configuración, JWT y límite HTTP entre entornos. Las **69 pruebas opt-in de la suite completa PostgreSQL/Redis se omitieron** en esta ejecución; no se apuntó esa suite destructiva a la base de desarrollo. El smoke de imagen sí verificó migraciones y autenticación contra un PostgreSQL nuevo y desechable.
- Mobile: **235 pruebas aprobadas**, incluidas 19 de configuración y la cabecera de entorno del cliente HTTP; TypeScript y lint aprobados.
- Expo generó las tres configuraciones y proyectos Android aislados; se comprobaron `applicationId`, esquema y nombre nativos.
- Imagen runtime y de pruebas construidas con dependencias fijadas.
- Smoke del runtime: migraciones PostgreSQL, readiness, registro, refresh y autenticación aprobados; token de otro entorno rechazado; configuración productiva insegura rechazada; ejecución con UID 10001 y sin `.env` en la imagen.
- Las dos definiciones Compose alojadas pasan validación sin desplegar servicios.
- Ruff, snapshots OpenAPI/realtime y DTO TypeScript generado: aprobados. Se fijó LF en el archivo generado para evitar falsos negativos entre Windows y Linux.
- Bundle Android productivo compilado con Hermes: 2.059 módulos, salida bajo `local-files/phase01/android-production-bundle/`. Se usaron valores sintéticos y carga de `.env` deshabilitada.
- Workflow revisado con actionlint: sin errores. La rama ya se integró; falta enlazar y comprobar el resultado de CI remota del candidato que se vaya a certificar.
- Herramientas OpenAPI: tres dependencias transitivas actualizadas dentro de rangos compatibles; `npm audit` de las herramientas de la raíz terminó con cero vulnerabilidades. Esta cifra no representa una auditoría de todas las dependencias de mobile/backend.

### Instalación Android y Pruebas temporal — 2026-09-09

- EAS finalizó las builds de Desarrollo `93c514f6-e85b-44ff-a189-6bf27406fea2` y Pruebas `bf2dd2df-c20a-4859-a61e-a449090778ae`. El archivo enviado se revisó: 220 archivos de mobile, sin backend, `.env`, credenciales de firma ni artefactos locales; `.easignore` limita el contenido enviado.
- Los dos APK descargados pasan integridad ZIP, verificación criptográfica con `apksigner` y comprobación de identidad nativa, esquema, entorno y API. Pruebas incluye su bundle JavaScript y no depende de Metro. Evidencia local: `local-files/phase01/development-apk-verification.json` y `testing-apk-verification.json`.
- El usuario instaló **ViajaYa Desarrollo** y confirmó que llega al login. Metro está accesible en la LAN. Esto no certifica todavía un viaje completo ni el funcionamiento de Maps/OAuth en el teléfono.
- Pruebas usa el proyecto Docker `viajaya-testing-local`, con PostgreSQL, Redis, usuarios ficticios y secreto JWT separados. La API escucha en `127.0.0.1:8001` y se expone mediante un túnel HTTPS temporal autorizado por el usuario.
- Verificación real de Pruebas por HTTPS: readiness, login, perfil, refresh y WebSocket aprobados; cabecera de entorno incorrecta rechazada y token de Pruebas rechazado en Desarrollo. Desarrollo sigue sano. Evidencia: `local-files/phase01/testing/verification-report.json`.
- APK, enlaces, QR y guía de instalación guardados en `local-files/phase01/`. El usuario también instaló **ViajaYa Pruebas** y confirmó que aparece el login con el distintivo **Pruebas**. La comprobación de acceso con cuentas y de un viaje completo desde los teléfonos sigue pendiente.

## Condiciones externas y siguiente fase

No consta alojamiento permanente certificado de pruebas/producción ni entrega SMS real. El servidor temporal de Pruebas requiere mantener esta PC, Docker y el túnel encendidos. En F02 se recuperó HTTPS con ngrok; si cambia la URL incorporada al binario, hace falta recompilarlo. No sustituye el despliegue y la operación previstos en F09.

Se configuró explícitamente la clave pública móvil de Maps existente como variable de Pruebas en EAS. Separar credenciales de Google por entorno y certificar restricciones por paquete/firma sigue pendiente. También quedan pendientes la certificación funcional completa en teléfonos, el binario productivo, iOS y la publicación en tiendas.

El historial local confirma la integración del PR #15 en `main` el 14/09. No se consultó GitHub Actions en la revisión del 19/09; no se infiere una CI remota aprobada a partir del merge.

Siguiente cierre: completar la certificación de F02 y su adaptador SMS; F03-A puede avanzar como trabajo independiente. Guía operativa: `docs/environments.md`.
