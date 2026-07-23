# Monitoreo realtime de ViajaYa

Con `OPENMETRICS_ENABLED=true`, la API expone `/metrics` en formato OpenMetrics
1.0. El endpoint no publica payloads, topics, DSN ni errores internos. En `off`
informa únicamente la configuración y los contadores locales; en `shadow`,
`live_local` o `live_redis` añade el corte persistido de la outbox. En
`live_redis` expone además conexión, reconexiones, mensajes inválidos, fanout y
cantidad de sockets locales, sin publicar canales ni payloads. Si la presencia
compartida está activa, añade salud y contadores de renovaciones, desconexiones,
observaciones y fallos; nunca incluye ride IDs ni connection IDs.
Cuando `SCHEDULED_ACTIONS_MODE=shadow|live`, el mismo documento añade backlog,
leases, ejecución y retención del scheduler; `/health/scheduled-actions` ofrece
el corte JSON equivalente para diagnóstico. Shadow ejecuta el worker además del
timer legacy, por lo que no debe acumular acciones `due` como comportamiento normal.

`prometheus.yml` conecta el scrape local, las reglas y Alertmanager. El job
comienza con `viajaya-backend`, como esperan las alertas. El perfil de Compose
expone las dos interfaces únicamente en loopback:

```bash
# El backend debe publicar /metrics antes de iniciar el perfil.
OPENMETRICS_ENABLED=true

docker compose --profile monitoring up -d prometheus alertmanager

# Prometheus:   http://127.0.0.1:9090
# Alertmanager: http://127.0.0.1:9093
```

Dentro de Docker, `host.docker.internal:8000` alcanza el backend de desarrollo
que corre en el host. Staging y producción deben reemplazar el target y
`external_labels.environment` por sus valores reales.

El Alertmanager versionado usa un receptor sin salidas externas: permite
comprobar agrupación, resolución y silencios desde su interfaz sin guardar
credenciales. Para un entorno real, monta un archivo administrado por secretos:

```bash
VIAJAYA_ALERTMANAGER_CONFIG_PATH=/ruta/segura/alertmanager.yml \
  docker compose --profile monitoring up -d alertmanager prometheus
```

Ese archivo no debe vivir en el repositorio. Debe configurar el receptor real y
su política de escalamiento.

Las reglas comunes asumen un Prometheus aislado por entorno. Si una misma
instancia monitorea varios jobs ViajaYa, cada entorno debe copiar y acotar las
reglas `absent(...)` a su `job` o label de entorno; una expresión genérica no
puede descubrir el nombre de un job que desapareció por completo.

Desde la raíz del repositorio se valida la configuración completa con las mismas
versiones fijadas en CI:

```bash
docker run --rm --entrypoint /bin/promtool \
  -v "$PWD/ops/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.11.3 \
  check config /etc/prometheus/prometheus.yml

docker run --rm --entrypoint /bin/amtool \
  -v "$PWD/ops/monitoring/alertmanager:/etc/alertmanager:ro" \
  prom/alertmanager:v0.32.1 \
  check-config /etc/alertmanager/alertmanager.yml
```

Las reglas asumen un scrape cada 30–60 s. Los umbrales de 120 s para
backlog, 10 s para publicación y 10 min para reintentos son valores canary:
deben ajustarse con datos de staging antes de promover cada modo live.

`ViajaYaRealtimeNuevaCuarentena` usa el incremento de una gauge durable porque
las cuarentenas nunca son podadas por la retención. Puede perder un incremento
ocurrido durante una caída larga de Prometheus; al recuperarlo, operación debe
revisar también el estado persistente en `/health/realtime`. Los destinos reales
de Alertmanager se configuran fuera del repositorio para no versionar
credenciales; la configuración local versionada no envía notificaciones.

El despliegue debe restringir `/metrics` a Prometheus mediante ingress, firewall
o política de red. El flag evita publicar accidentalmente el endpoint, pero no
reemplaza ese control perimetral.

Las métricas de backlog y cuarentena describen la misma PostgreSQL desde cada
réplica; las reglas eliminan `instance`/`pod` para no duplicar alertas. Las
señales de procesos (`up`, dispatcher y retención) sí permanecen por instancia.

El modo esperado depende del entorno y no se codifica en las reglas comunes.
Staging o producción deben añadir una regla sobre
`viajaya_realtime_outbox_info{mode="live_redis"}` cuando esa fase sea obligatoria.

## Diagnóstico rápido

- Scrape o colección: consulta `/health/live`, `/health/ready`,
  `/health/realtime` y `/health/scheduled-actions`; confirma red, PostgreSQL y
  migraciones `0018`–`0023`.
- Dispatcher o retención detenidos: revisa readiness y logs sanitizados del
  proceso; no reinicies otro consumidor hasta confirmar el advisory lock.
- Redis desconectado o inestable: confirma `PING`, red y ACL. El proceso debe
  quedar fuera de readiness y cerrar sus sockets con 1012; no fuerces `published_at`
  porque PostgreSQL conserva el batch para retry cuando el publish falla.
- Presencia compartida: confirma ambas señales Redis (bridge y store). Durante
  la caída y durante una gracia completa después de recuperarse,
  `cancel_absent_ride` debe aplazarse sin pasar a `dead`.
- Backlog o reintentos: compara edad, batches y último publish. Conserva las
  filas pendientes para replay; no las marques manualmente como publicadas.
- Cuarentena: registra el código, identifica el productor incompatible y fuerza
  un nuevo snapshot después de corregirlo. La retención no borra la evidencia.
- Publicación lenta: correlaciona el instante de la última publicación con carga
  de PostgreSQL. Esta gauge describe el último batch, no un percentil ni un SLO.
- Scheduler: una acción `due` envejecida indica ejecución atrasada; un lease
  `stale` debe recuperarse automáticamente. No borres acciones `dead`: conserva
  su código sanitizado y corrige el handler antes de reprogramarlas. La retención
  automática solo elimina `succeeded/cancelled` después del TTL configurado. La
  alerta crítica observa nuevas transiciones a `dead` en una ventana de 10 min y
  se resuelve al cesar el incidente; la gauge `dead_persisted` conserva el inventario.

La automatización del receptor, silencios y escalamiento pertenece a
Alertmanager del entorno. No hay un acknowledgement persistido para cuarentenas;
el runbook debe comprobarlas después de cualquier interrupción de Prometheus.
