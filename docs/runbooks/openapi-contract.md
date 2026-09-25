# OpenAPI contract evolution

`backend/openapi.json` is the deterministic snapshot of the HTTP contract and
`mobile/src/core/http/generated/openapi.ts` contains the reproducible types that
mobile consumes. Both must change in the same delivery as the corresponding endpoint, schema,
DTO, mapper and tests.

## Checks

From the root:

```bash
cd backend
.venv/bin/python -m scripts.export_openapi --check

cd ..
npm run openapi:check
```

On every pull request, CI extracts `backend/openapi.json` from the base commit and runs
`oasdiff 1.17.0`. The job fails on `WARN` or `ERR` levels; this includes both
confirmed breaks and changes that need explicit review. The semantic
diff complements the deterministic snapshot: it does not replace it.

To reproduce the comparison against `origin/main`:

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

The temporary file contains no secrets: it is only the public contract.

## Intentionally incompatible change

Do not silence a break just to turn CI green. Before allowing it:

1. introduce a compatible transition or a new version;
2. deploy consumers with dual reading first;
3. document the minimum supported app version and the removal criterion;
4. add tests for the previous producer, the new producer and rollback;
5. approve the exception in a separate, traceable delivery.

`oasdiff` ignore lists are only acceptable for documented false
positives. They must never hide removed endpoints, new required fields,
enum reductions or type changes that mobile still consumes.
