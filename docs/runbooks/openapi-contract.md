# Evolución del contrato OpenAPI

`backend/openapi.json` es el snapshot determinista del contrato HTTP y
`mobile/src/core/http/generated/openapi.ts` contiene los tipos reproducibles que
consume mobile. Ambos deben cambiar en la misma entrega que el endpoint, schema,
DTO, mapper y pruebas correspondientes.

## Comprobaciones

Desde la raíz:

```bash
cd backend
.venv/bin/python -m scripts.export_openapi --check

cd ..
npm run openapi:check
```

En cada pull request, CI extrae `backend/openapi.json` del commit base y ejecuta
`oasdiff 1.17.0`. El job falla ante niveles `WARN` o `ERR`; esto incluye tanto
rupturas confirmadas como cambios que necesitan revisión explícita. El diff
semántico complementa al snapshot determinista: no lo reemplaza.

Para reproducir la comparación contra `origin/main`:

```bash
base_spec="$(mktemp)"
git show origin/main:backend/openapi.json > "$base_spec"

docker run --rm \
  -v "$base_spec:/specs/base.json:ro" \
  -v "$PWD/backend/openapi.json:/specs/revision.json:ro" \
  tufin/oasdiff:v1.17.0 \
  breaking --fail-on WARN \
  /specs/base.json /specs/revision.json
```

El archivo temporal no contiene secretos: es únicamente el contrato público.

## Cambio intencionalmente incompatible

No se debe silenciar una ruptura solo para poner CI en verde. Antes de permitirla:

1. introducir una transición compatible o una nueva versión;
2. desplegar primero consumidores con lectura dual;
3. documentar la versión mínima soportada de la app y el criterio de retiro;
4. añadir pruebas para productor anterior, productor nuevo y rollback;
5. aprobar la excepción en una entrega separada y trazable.

Las listas de ignore de `oasdiff` solo son aceptables para falsos positivos
documentados. Nunca deben ocultar endpoints retirados, campos requeridos nuevos,
reducciones de enum o cambios de tipo que mobile todavía consuma.
