# F01 — Base técnica y tres entornos

Fecha: 2026-09-09. Rama de trabajo: `codex/phase-01-environments`.

Estado: **F01 completada y verificada localmente**, con APK de Desarrollo y Pruebas compilados y firmados en EAS. Corresponde a F01 del plan local de salida a producción. Pruebas funciona temporalmente en esta PC con acceso HTTPS; no se ha contratado alojamiento ni implementado F02.

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
- Workflow revisado con actionlint: sin errores. Las ejecuciones remotas de los jobs siguen pendientes hasta publicar la rama.
- Herramientas OpenAPI: tres dependencias transitivas actualizadas dentro de rangos compatibles; `npm audit` de las herramientas de la raíz terminó con cero vulnerabilidades. Esta cifra no representa una auditoría de todas las dependencias de mobile/backend.

### Instalación Android y Pruebas temporal — 2026-09-09

- EAS finalizó las builds de Desarrollo `93c514f6-e85b-44ff-a189-6bf27406fea2` y Pruebas `bf2dd2df-c20a-4859-a61e-a449090778ae`. El archivo enviado se revisó: 220 archivos de mobile, sin backend, `.env`, credenciales de firma ni artefactos locales; `.easignore` limita el contenido enviado.
- Los dos APK descargados pasan integridad ZIP, verificación criptográfica con `apksigner` y comprobación de identidad nativa, esquema, entorno y API. Pruebas incluye su bundle JavaScript y no depende de Metro. Evidencia local: `local-files/phase01/development-apk-verification.json` y `testing-apk-verification.json`.
- El usuario instaló **ViajaYa Desarrollo** y confirmó que llega al login. Metro está accesible en la LAN. Esto no certifica todavía un viaje completo ni el funcionamiento de Maps/OAuth en el teléfono.
- Pruebas usa el proyecto Docker `viajaya-testing-local`, con PostgreSQL, Redis, usuarios ficticios y secreto JWT separados. La API escucha en `127.0.0.1:8001` y se expone mediante un túnel HTTPS temporal autorizado por el usuario.
- Verificación real de Pruebas por HTTPS: readiness, login, perfil, refresh y WebSocket aprobados; cabecera de entorno incorrecta rechazada y token de Pruebas rechazado en Desarrollo. Desarrollo sigue sano. Evidencia: `local-files/phase01/testing/verification-report.json`.
- APK, enlaces, QR y guía de instalación guardados en `local-files/phase01/`. El usuario también instaló **ViajaYa Pruebas** y confirmó que aparece el login con el distintivo **Pruebas**. La comprobación de acceso con cuentas y de un viaje completo desde los teléfonos sigue pendiente.

## Condiciones externas y siguiente fase

No se ha aprovisionado alojamiento permanente de pruebas/producción ni enviado SMS reales. El servidor temporal de Pruebas requiere mantener esta PC, Docker y el túnel encendidos; al reiniciar el túnel cambia la URL y hace falta recompilar el APK con ella. No sustituye el despliegue y la operación previstos en F09.

Se configuró explícitamente la clave pública móvil de Maps existente como variable de Pruebas en EAS. Separar credenciales de Google por entorno y certificar restricciones por paquete/firma sigue pendiente. También quedan pendientes la certificación funcional completa en teléfonos, el binario productivo, iOS y la publicación en tiendas.

No se han creado commits ni publicado esta rama. La ejecución remota de GitHub Actions sigue pendiente hasta publicar los cambios.

Siguiente fase: F02, acceso por teléfono, OTP simulado con autofill en ambientes bajos, cuentas sociales y recuperación. Guía operativa: `docs/environments.md`.
