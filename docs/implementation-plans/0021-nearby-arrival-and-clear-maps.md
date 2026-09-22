# Llegada cercana y mapas despejados

19/09/2026 · Implementado; verificación local registrada abajo y cartografía nativa pendiente · `codex/ui-improvements-and-bugfixes`.

## Problemas reproducidos

- Al ofertar junto al pasajero, Google devuelve HTTP 200, duración `0s`, un solo
  punto y omite `distanceMeters` por ser cero. El selector exigía dos puntos y
  distancia explícita; rechazaba esa respuesta válida y mostraba un falso error
  de conexión. Se reprodujo con taxi y mototaxi, coordenadas coincidentes y
  separadas unos 4 m. Las consultas normales también respondieron correctamente.
- Configuración comenzaba el mapa debajo de una franja de 64 más el área segura,
  aunque los controles superiores ya eran flotantes.
- Búsqueda sin ofertas reservaba 160 arriba y un margen inferior duplicado. La
  hoja podía cubrir el 88 %; con letra grande, el aviso de moto tapaba la ruta y
  el botón Cancelar recortaba su texto.
- El usuario volvió a observar oscurecimiento al ampliar en tema claro. La
  revisión 20 desactivaba edificios 3D y recoloreaba huellas, pero todavía dejaba
  geometrías de terreno/POI e interiores; los selectores permitían inclinación.
  Sin teléfono conectado no se atribuye el efecto visual a una única capa.

## Cambios

- Aceptar un solo punto exclusivamente en rutas estacionarias de duración y
  distancia cero; normalizar distancia omitida únicamente en ese caso. Se
  conservan validación geográfica y elección de la alternativa más rápida.
- Llegada calculada automáticamente; el mínimo del contrato sigue siendo 1 min.
  No se inventa geometría ni se sustituye ruta de moto por automóvil. En mapas,
  el encuadre usa los puntos del viaje si la respuesta tiene un solo punto y
  no dibuja una línea como si fuera una ruta calculada.
- Separar proveedor no disponible, ruta inexistente, respuesta incompleta,
  timeout y fallo de conexión; conservar abortos. La consulta de mapa termina
  sin reintentos automáticos prolongados y mantiene reintento explícito.
- Mapa de configuración desde el borde superior; Volver y lugares encima, con
  altura real de cabecera para proteger los marcadores. Panel estable al cambiar
  de servicio. Búsqueda usa cabecera/panel medidos y hoja de máximo 64 % con
  desplazamiento interno. Aviso de moto dentro de la hoja; cancelar y campo de
  oferta crecen con el texto. Controles superiores y reintento de 48 como mínimo.
- Los siete mapas desactivan edificios, interiores, selector de planta e
  inclinación. El estilo común oculta las geometrías de construcciones, relieve
  y POI, conserva parques y calles, y separa el control de nombres de lugares.
  No se limita el zoom de los selectores ni se añade un velo sobre el mapa.

## Evidencia

- **396 pruebas móviles aprobadas**, 19 nuevas respecto de revisión 20: integración
  del cliente HTTP, parser y publicación de oferta con la respuesta real cercana;
  errores de proveedor/red/timeout/cancelación; validación de geometría; inventario
  de todos los sitios MapView para evitar reactivar las capas y la inclinación.
- **Seis consultas reales con el código productivo de rutas aprobadas:** taxi y
  moto en el mismo punto, a pocos metros y en un trayecto normal. No se crearon
  viajes u ofertas remotos. Evidencia antes/después sin claves ni tokens.
- **68 casos UI aprobados:** diez nuevos de controles sobre el mapa en ambos
  temas, búsqueda taxi/moto a 390×844 y 320×640 con texto al 200 %, llegada cercana
  y recuperación de errores; 17 de mapas, 14 de experiencia, 23 de negociación y
  cuatro de paginación. Sin errores JavaScript. Capturas inspeccionadas.
- TypeScript, lint y `git diff --check` limpios. API y Metro HTTP 200; bundle
  Android actualizado de **11.913.183 bytes**, sin reiniciar servicios. No se creó un emulador.
- Pantallas/hooks productivos, con superficie de mapa/GPS/red/navegación adaptados
  en las pruebas UI: comprueban espacio, cámara, props y acciones, **no** el
  sombreado de los tiles de Google Maps. ADB sin dispositivos. Falta confirmar
  visualmente en el teléfono del usuario zoom cercano en tema claro, tanto
  seleccionando ubicaciones como en configuración, espera y seguimiento.
- Plan/presentación sincronizados en revisión 21: 32 diapositivas verificadas en
  escritorio/móvil, navegación, lectura, impresión y descarga exacta del plan
  aprobadas. Backend y contratos sin cambios;
  se conserva como histórica la evidencia de backend/PostgreSQL de revisión 17.

Evidencia reproducible: `local-files/arrival-map-2026-09-19/`.

Referencias: [Expo 56](https://docs.expo.dev/versions/v56.0.0/),
[campos por defecto omitidos en Google Routes](https://developers.google.com/maps/documentation/routes/choose_fields),
[estilos de Google Maps Android](https://developers.google.com/maps/documentation/android-sdk/style-reference).
También se revisó el puente Android instalado de react-native-maps 1.27.2 para
confirmar el envío de propiedades al mapa nativo y sus valores predeterminados.
