# Experiencia de negociación, recogida y cierre

19/09/2026 · Implementado y verificado localmente · `codex/ui-improvements-and-bugfixes`.

Mejorar los recorridos de taxi/mototaxi para ambos participantes:

- Reservar espacio estable para el mapa y mantener las acciones principales visibles.
- Dar prioridad al punto de recogida/destino y a la identificación de la otra persona.
- Separar cancelación de la acción principal y explicar quién hace el siguiente paso.
- Permitir comparar ofertas por precio o llegada sin alterar la decisión del pasajero.
- Simplificar la calificación, mantener el envío visible y el comentario opcional.

Reutilizar los componentes y tokens existentes; no cambiar contratos ni reglas de
asignación, presencia, TTL, cancelación o calificaciones. Probar taxi/moto, ambos
roles, temas claro/oscuro, pantalla pequeña, letra grande, actualizaciones en vivo
y cierre. Las verificaciones con adaptadores no certifican mapa/GPS nativos.

## Entrega

- Panel fijo al 64 % de la vista en ofertas y seguimiento de ambos roles. Su
  contenido se desplaza dentro del panel; el mapa conserva el espacio restante
  y sus gestos bloqueados. Abrir detalles no mueve el panel ni la acción principal.
- Conductor: origen al recoger y destino al viajar dentro del aviso de etapa;
  nombre, llamada y mensaje antes del detalle ampliado. Tarifa/pago compactos.
  La confirmación sigue siendo obligatoria antes de llegar, iniciar o finalizar.
- Pasajero: aviso de llegada destacado, confirmación de «ya salí» clara y resumen
  ampliable con ruta, tarifa y pago. Al iniciar desaparece la cancelación; en
  etapas anteriores se conserva como acción secundaria y con confirmación.
- Ofertas: selección explícita entre recientes, menor precio y menor llegada.
  Las ofertas con ETA desconocida van al final y los empates conservan su orden;
  no se modifica el array de React Query ni se elige un conductor automáticamente.
- Calificación: envío visible desde el comienzo, deshabilitado hasta elegir
  estrellas. El comentario es opcional y se abre a demanda; ocultarlo o fallar
  el envío conserva estrellas y borrador. Omitir sigue disponible.

## Evidencia del 19/09/2026

- **373 pruebas móviles aprobadas**, incluidas seis nuevas para comparación;
  TypeScript y lint limpios. `git diff --check` sin errores.
- **14 casos UI nuevos:** cinco recorridos por servicio para detalle estable,
  llegada/aviso/inicio, calificación del conductor con fallo/reintento, recogida
  y cierre del pasajero y comparación/selección; cuatro pantallas adicionales
  con 320×640, tema oscuro y letra al 200 %.
- **27 casos UI anteriores aprobados de nuevo**: negociación simultánea,
  navegación, retirada, respuestas atrasadas, recogida modificada y paginación.
  Total: **41 casos**, sin errores JavaScript. Se inspeccionaron capturas de
  ambos roles, negociación, calificación y accesibilidad. Pantallas y hooks reales;
  adaptadores de red, GPS, mapa, navegación y contacto nativo.
- API y Metro responden HTTP 200; bundle Android actualizado de **11.909.378 bytes**,
  con la nueva comparación de ofertas. No se reiniciaron servicios.
- Backend/contratos/base de datos sin cambios. Se conserva como histórica la
  evidencia de la revisión 17: 731 backend y 9 PostgreSQL aprobadas.
- Plan y presentación actualizados a revisión 18: 32 diapositivas verificadas,
  navegación/lectura/impresión y descarga idéntica al plan, sin desbordamientos
  en escritorio/móvil ni errores JavaScript.
- Acciones secundarias basadas en `Button`, controles táctiles de al menos 48
  puntos, foco visible y marca de selección además del color al ordenar ofertas.

Evidencia reproducible y capturas: `local-files/trip-experience-2026-09-19/`.
Continúa pendiente el recorrido de la versión actual en dos teléfonos reales.
