# Componentes compartidos y tarjetas del viaje

19/09/2026 · Implementado y verificado localmente · `codex/ui-improvements-and-bugfixes`.

Pulir la base visual utilizada por taxi/mototaxi: botones, campos, diálogos,
estados de carga/error y tarjetas de personas/ofertas. Reutilizar la marca y los
tokens, mantener objetivos táctiles de 48, foco visible, tema oscuro y letra grande.

Aplicar los componentes en pantallas reales y comprobar las interacciones antes
de cerrar: bloqueo de envíos, estados deshabilitados, edición de comentarios,
confirmación/cancelación y negociaciones concurrentes. No cambiar contratos ni
reglas de negocio. Documentar qué se verificó con adaptadores y qué queda nativo.

## Entrega

- `Button`: bordes de 16, acción principal destacada, alternativa con borde
  legible, respuesta al pulsar y estados deshabilitados/cargando diferenciados.
  Se conserva el mínimo táctil de 48, crecimiento del texto y foco visible.
- `TextField`: etiquetas persistentes, ayuda bajo el campo, error con prioridad
  sobre la ayuda, contador opcional y límite nativo. El foco no cambia el tamaño.
  Se mantiene la contraseña alternable y se distingue el campo no editable.
- `ConfirmDialog`: tarjeta inferior en móvil y centrada en pantallas amplias.
  El contenido puede desplazarse; confirmar y volver permanecen en el pie.
  Respetan el área segura, la letra grande y el cierre al tocar fuera.
- `FeedbackState`: icono y carga con espacio estable, título claro y reintento
  deshabilitado mientras se actualiza para impedir solicitudes repetidas.
- `PersonAvatar`: iniciales del nombre/apellido o icono de respaldo, reutilizado
  en solicitudes, ofertas, seguimiento y calificación; el nombre completo sigue
  siendo accesible y escalable junto al avatar decorativo.
- Ofertas con precio y llegada en un bloque legible. Perfil con ayuda del nombre;
  comentario de calificación basado en el campo compartido, conservando borrador,
  contador, límite, ocultación y reintentos.

## Evidencia del 19/09/2026

- **373 pruebas móviles aprobadas**, TypeScript y lint limpios;
  `git diff --check` sin errores.
- **12 casos UI nuevos**: bloqueo de acciones/foco, ayuda/error/límite de campo,
  contraseña/no editable, confirmación/cancelación y reintento durante carga en
  ambos temas; diálogos y campos a 200 % en 320×640 y 390×640.
- **41 casos UI anteriores aprobados de nuevo**: 14 de experiencia del viaje,
  23 de negociación y cuatro de recuperación/paginación, para taxi y moto.
  **53 en total**, sin errores JavaScript. Capturas inspeccionadas después de
  finalizar las animaciones, incluidos tema oscuro y letra grande.
- Se ejecutaron pantallas, componentes y hooks reales con adaptadores de red,
  navegación, mapas, GPS y contacto nativo. No certifica comportamiento de mapa,
  teclado, áreas seguras o lectores de pantalla en dispositivos físicos.
- API/Metro responden HTTP 200. Bundle Android de **11.911.693 bytes**, con el
  avatar y contador compartidos. Servicios existentes conservados, sin reinicios.
- Galería local verificada al abrir desde archivo, pulsar acciones y cambiar de
  tema. Plan/presentación en revisión 19: 32 diapositivas sin desbordamientos,
  navegación, lectura, impresión y descarga idéntica al plan verificadas.
- Backend, contratos y base de datos sin cambios en esta entrega. Su evidencia
  histórica sigue en la revisión 17: 731 backend y nueve PostgreSQL aprobadas.

Galería interactiva y evidencia reproducible:
`local-files/shared-components-2026-09-19/`. La galería usa datos de demostración.
Continúa pendiente el recorrido de la versión actual en dos teléfonos reales.
