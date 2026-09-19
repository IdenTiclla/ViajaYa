# Experiencia completa de recogida y viaje

19/09/2026 · Rama `codex/ui-improvements-and-bugfixes` · Implementado y verificado localmente; certificación nativa pendiente.

## Recorrido acordado

1. El pasajero compara y confirma precio, conductor y llegada estimada.
2. El conductor llega al origen y confirma «Ya llegué»; ambos ven la recogida.
3. El pasajero pulsa «Ya salí, voy al punto» y ve la confirmación del aviso.
   El conductor ve que el pasajero está en camino al punto de recogida.
4. El conductor confirma que el pasajero está a bordo e inicia el viaje.
5. Al llegar al destino, el conductor finaliza; el pasajero califica y vuelve al inicio.

El aviso de salida no prueba que el pasajero esté a bordo ni inicia el viaje.
Si el pasajero ya está a bordo y no usa el aviso, el conductor puede iniciar tras
confirmar identidad y presencia. Se conservan las etapas públicas existentes y las
reglas de cancelación/presencia del plan 0007.

## Criterios de cierre

- [x] Aviso persistente, autorizado solo al dueño, idempotente y válido en recogida.
- [x] Respuesta HTTP, WebSockets, outbox y snapshots comparten el mismo dato.
- [x] Doble toque, respuesta perdida, lectura atrasada y carreras con inicio/cancelación verificados.
- [x] Negociación confirma la oferta vigente y recupera una aceptación guardada.
- [x] Cada rol ve etapa, siguiente acción y errores recuperables; texto ampliado y pantallas pequeñas revisados.
- [x] Recorrido completo taxi/mototaxi y calificación verificados con pantallas y API.
- [x] TypeScript, lint, contratos, migración y bundle Android comprobados.
- [ ] Recorrido en dos teléfonos reales (certificación nativa).

GPS compartido, navegación giro a giro y conciliación QR conservan los criterios
productivos del plan general. No se presentan como funciones completadas por este cambio.


## Contrato y recuperación

`POST /api/v1/rides/{ride_id}/rider-on-the-way` guarda `rider_on_the_way_at`.
Solo el pasajero propietario puede crearlo, después de la llegada y para taxi/moto.
Un reintento devuelve el aviso original, incluso si el viaje ya avanzó. El primer
aviso después de iniciar/cancelar se rechaza. El bloqueo PostgreSQL serializa el
aviso con inicio/cancelación y el outbox se guarda en la misma transacción.
HTTP, eventos `ride_status` y snapshots entregan el mismo dato. Los consumidores
aceptan eventos antiguos sin el campo y conservan los avisos ya confirmados.
La migración aditiva `0030_rider_pickup_notice` no inventa avisos históricos.

La negociación presenta conductor, vehículo, placa, precio y ETA antes de asignar.
Si la oferta vence dentro de la confirmación, se explica y no se envía una aceptación.
El backend conserva la aceptación atómica y el vencimiento de 30 segundos.
La confirmación de llegada y la de inicio son acciones distintas del conductor.

## Evidencia del 19/09/2026

- Backend completo: **721 aprobadas, 86 omitidas**, cinco advertencias preexistentes.
  Las omitidas requieren infraestructura/flags optativos. Las pruebas específicas
  añadidas de PostgreSQL se ejecutaron aparte, en una base desechable.
- API/WS afectadas: **40 aprobadas**; después se amplió el caso de recogida para
  comprobar también snapshots de ambos roles: **4 aprobadas**. Mismo aviso/estado
  tras GET, reintento, inicio, finalización y calificación. Outbox: una entrega por
  participante, sin duplicados durables al repetir el aviso.
- PostgreSQL: **4 aprobadas**; doble aviso simultáneo, aviso frente a inicio o
  cancelación y rollback si falla el outbox. Migración `0030`: upgrade, downgrade
  y upgrade en una base aislada; aplicada después a desarrollo sin reinicio manual.
- Mobile: **311 aprobadas**, TypeScript/lint y contratos OpenAPI/realtime aprobados.
  Incluye HTTP perdido, aviso no guardado, aceptación fallida, evento atrasado y
  snapshots en vuelo que no borran un aviso confirmado ni revierten el inicio.
- Pantallas reales, React Query y hooks reales: dos recorridos completos (taxi/moto),
  con respuesta perdida al aceptar, avisar, finalizar y calificar. Doble toque envía
  una sola petición; error antes de guardar permite reintentar; llegada tardía del
  aviso limpia el error; oferta vencida dentro del diálogo no se acepta.
- UI: **40 combinaciones** de rol/etapa/servicio a 390×844 con texto normal/tema claro
  y 320×640 con texto al 200 %/tema oscuro, más **16 diálogos**. Acciones alcanzables,
  contenido desplazable y sin desbordamiento horizontal ni errores JavaScript.
- Bundle Android completo de Metro: **HTTP 200, 11.885.261 bytes**. API y Metro sanos.
  Es compilación JavaScript, no un APK instalado ni una prueba de render nativo.
- Plan y presentación: **revisión 13**. F04 conserva sus criterios operativos pendientes.

Evidencia reproducible: `local-files/pickup-experience-2026-09-19/` (ignorada en Git).
El visor usa componentes reales sobre React Native Web; sustituye repositorio HTTP,
mapa, ubicación, contactos y navegación nativa. Sincroniza los dos roles en el límite
de la caché. API/WS y PostgreSQL se comprueban por separado; no simula una prueba
integrada en teléfonos. Queda por certificar teclado/TalkBack, contactos, mapas,
suspensión/reanudación y desconexión real en dos dispositivos.


**Continuación, revisión 14:** las pruebas del usuario detectaron un error de
cancelación interna al calificar como conductor y cambios de encuadre entre
servicios. La ETA manual se reemplazó por cálculo automático GPS → recogida.
Ver [corrección, rutas con tráfico y evidencia actual](../implementation-plans/0014-automatic-arrival-and-stable-route.md).
