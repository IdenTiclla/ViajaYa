# Mapas planos, cámara fija y encuadre cercano

19/09/2026 · Implementado y verificado localmente · `codex/ui-improvements-and-bugfixes`.

- Quitar edificios en relieve y contornos oscuros al acercar el mapa, en ambos temas.
- Bloquear gestos en el mapa de espera del conductor y anclar el radar a la
  proyección de su coordenada GPS, incluyendo cambios de posición y tamaño.
- Retirar los dos bloques A/B superiores de configuración; conservar edición
  accesible y marcadores sobre la ruta.
- Acercar el encuadre de rutas completas en ambos roles, usando márgenes menores
  y tamaños reales de los paneles. No cambiar la elección de ruta ni contratos.
- Verificar proyección/cámara, mapas con adaptadores, configuración entre
  servicios, pruebas móviles, TypeScript/lint y bundle Android. Distinguir lo
  automatizado del acabado cartográfico pendiente en teléfono.

## Resultado

- Los siete mapas desactivan `showsBuildings`. El estilo común fija el relleno
  de construcciones al color de suelo del tema y oculta sus contornos, también
  cuando se activan nombres de lugares. La selección manual de puntos conserva
  sus gestos; espera y rutas del conductor/pasajero quedan bloqueadas.
- La espera del conductor ya no activa el modo interactivo. El radar vive dentro
  del mapa y usa la proyección nativa del mismo GPS que el vehículo, con tamaño
  acotado al contenedor. Reproyecta al cambiar ubicación, tamaño o cámara;
  ignora respuestas anteriores y se oculta sin coordenadas o proyección válida.
- El seguimiento de cámara usa `setCamera` sin animación, norte arriba y sin
  inclinación; no hay un estado que se desactive al arrastrar.
- Se retiran los dos bloques A/B superiores de configuración y el espacio que
  reservaban. Los marcadores conservan sus acciones de edición existentes.
  Configuración encuadra con 24 arriba/abajo y 32 a los lados, manteniendo tamaño
  del panel y mapa al cambiar taxi, moto, encomiendas o mudanza.
- Seguimiento/negociación usa márgenes compactos de 40 vertical/44 horizontal;
  direcciones largas mantienen 72/88. Se considera toda la polilínea, incluidas
  curvas, y los valores enviados a Android son enteros.
- Solicitudes en mapa mide su cabecera. Oferta enviada mide cabecera/panel y
  mantiene el panel al 64 %, en lugar de estimar 440 sobre un panel variable
  que podía ocupar el 82 %. La ruta conserva espacio y sus acciones se desplazan
  dentro del panel. No cambian negociación, ETA ni elección de la ruta óptima.

## Evidencia del 19/09/2026

- **377 pruebas móviles aprobadas**, incluidas cuatro nuevas de encuadre cercano
  y medidas fraccionarias; pruebas de estilo ampliadas a construcciones en ambos
  temas y estados del selector de lugares. TypeScript/lint limpios.
- **17 casos UI nuevos:** configuración y cuatro servicios en claro/oscuro;
  diez vistas con ruta (cinco por servicio); proyección del radar desplazada
  respecto del centro de pantalla, cambio de tamaño, respuestas GPS atrasadas
  y pérdida de coordenadas; configuración a 320×640 con texto al 200 %.
- **41 casos UI anteriores aprobados otra vez:** 14 de experiencia, 23 de
  negociación y cuatro de paginación. Total **58**, sin errores JavaScript.
- Capturas inspeccionadas de configuración, espera, solicitudes y seguimiento
  de ambos roles. Mapas/pantallas/hooks productivos con superficie nativa, rutas,
  GPS, red y navegación adaptados; la geometría simulada conserva proporciones.
- API/Metro HTTP 200; Android actualizado de **11.909.836 bytes**, con cámara y
  proyección nuevas. No se reiniciaron API/Metro ni se abrió un emulador.
- No hay Android conectado por ADB: sigue pendiente verificar cartografía nativa,
  sombreado al ampliar, proyección sobre Google Maps y aspecto con GPS real.
  La previsualización no certifica los bitmaps de edificios del proveedor.
- Plan y presentación en revisión 20: 32 diapositivas verificadas, sin
  desbordamientos ni errores JavaScript; navegación, lectura, impresión y
  descarga idéntica al plan aprobadas.
- Backend y contratos sin cambios. Evidencia histórica de revisión 17 conservada.

Archivos reproducibles, registros y capturas:
`local-files/map-framing-2026-09-19/`.

Referencias: [Expo Maps 56](https://docs.expo.dev/versions/v56.0.0/sdk/map-view/),
[estilos de Google Maps](https://developers.google.com/maps/documentation/javascript/style-reference).
Se revisó además la implementación instalada de react-native-maps 1.27.2 para
confirmar unidades lógicas de proyección y disponibilidad de edificios/cámara.
