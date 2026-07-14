# ViajaYa — guía de trabajo para agentes

ViajaYa es un monorepo de taxis y encomiendas con negociación de tarifas en tiempo real:

- `backend/`: FastAPI async + SQLAlchemy 2.0 async + PostgreSQL, en Clean Architecture.
- `mobile/`: Expo/React Native + TypeScript, Expo Router, React Query y Zustand.
- `docs/implementation-plans/`: decisiones y planes de implementación. Los planes terminados viven en `archived/`.

## Antes de cambiar código

1. Revisa `git status --short`. Trata los cambios ajenos al alcance como trabajo del usuario: no los reviertas, borres ni reformatees masivamente.
2. Lee `CLAUDE.md` en esta raíz y luego las instrucciones más cercanas al código que vayas a tocar:
   - Backend: `backend/CLAUDE.md`.
   - Mobile: `mobile/AGENTS.md` y `mobile/CLAUDE.md`.
3. Consulta el plan activo que corresponda en `docs/implementation-plans/`. En particular, `0007-cancela-busqueda-pasajero-ausente.md` documenta las reglas vigentes de presencia y cancelación por desconexión.
4. Si el cambio cruza backend y mobile, define y actualiza ambos lados del contrato en la misma tarea.

## Reglas globales

- Escribe código, comentarios, documentación y mensajes de commit en español.
- No incluyas secretos ni modifiques/commitees archivos `.env`; usa los `.env.example` como referencia.
- No hagas commits, pushes, migraciones destructivas ni reinicios de procesos existentes salvo solicitud explícita.
- Para levantar servicios, primero inspecciona qué ya está sano (DB, backend, Metro y puertos). No levantes un emulador Android a menos que se pida expresamente; consume mucha memoria.

## Límites de arquitectura

### Backend

- Las dependencias fluyen hacia adentro: `api → application → domain`. El dominio no importa framework, infraestructura, API ni application.
- Un caso de uso por archivo, con `async def execute(...)`. El cableado de dependencias se concentra en `app/api/deps.py`; routers traducen HTTP a casos de uso, sin lógica de negocio.
- Los schemas Pydantic no son entidades de dominio. Los errores de negocio son `DomainError` y se traducen centralmente en `api/errors.py`.
- Mantén todo async. Al cambiar el esquema de PostgreSQL, crea y revisa manualmente la migración Alembic.

### Mobile

- Las rutas de `src/app/` solo componen pantallas. La lógica vive por feature, en `domain/`, `data/`, `application/` y `presentation/`.
- Todo HTTP usa `src/core/http/client.ts`; no uses `fetch` ni instancias Axios adicionales. Configuración de runtime solo desde `@/core/config/env`.
- El WebSocket es la vía principal en tiempo real y actualiza la caché de React Query; el polling es respaldo lento. El token WS viaja por el subprotocolo `viajaya.auth`, nunca en la URL.
- Reutiliza componentes compartidos y tokens de `@/core/theme`. Antes de usar APIs de Expo, verifica la documentación oficial versionada de Expo 56; la app usa dev build, no Expo Go.

## Contrato y reglas de negocio compartidas

- La API está bajo `/api/v1`; los DTO del backend usan `snake_case` y el mobile los mapea a tipos de dominio en `features/*/data`.
- Cuando cambie un endpoint, schema o evento WebSocket, actualiza el schema/DTO/repositorio/tipo consumidor y sus pruebas en el otro proyecto.
- La negociación es decidida por el pasajero. La aceptación de una oferta debe permanecer atómica; las ofertas vencen a los 30 s.
- La presencia del pasajero tiene una gracia de 120 s, renovable por WebSocket o `GET /rides/me/active`. La cancelación automática solo puede afectar rides `SEARCHING` y debe conservar los eventos en tiempo real esperados.

## Verificación

Ejecuta las comprobaciones proporcionales al área modificada antes de entregar:

```bash
# Desde backend/
.venv/bin/pytest                 # o un archivo/directorio afectado
.venv/bin/ruff check .

# Desde mobile/
npx tsc --noEmit
npm run lint
```

Los tests unitarios del backend usan dobles; los e2e usan SQLite async. Para comportamiento en vivo de WebSocket, usa además el smoke test o el entorno completo cuando el alcance lo justifique.
