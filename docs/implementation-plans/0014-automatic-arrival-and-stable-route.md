# ETA automática, cierre y mapa estable

19/09/2026 · Implementado y verificado localmente · `codex/ui-improvements-and-bugfixes`.

Correcciones solicitadas tras probar el flujo en dispositivo:

- Calificar al pasajero debe cerrar el viaje sin convertir una cancelación interna
  de consultas en «No pudimos verificar tus viajes».
- Las cinco entradas de oferta/reoferta calculan ETA desde una ubicación reciente
  del conductor hasta la recogida. No hay entrada manual ni minutos inventados.
  Ubicación o ruta no disponibles muestran un error recuperable y no envían la oferta.
- Solicitar rutas con tráfico (`TRAFFIC_AWARE_OPTIMAL`) y alternativas; elegir menor
  duración válida y, en empate, menor distancia. Moto usa `TWO_WHEELER`; otros
  servicios `DRIVE`; la recogida de encomiendas usa el vehículo activo del conductor.
  «Óptima» significa la más rápida entre las alternativas que devuelve el proveedor
  en ese momento; no garantiza conocer incidentes que el proveedor todavía no reportó.
- Cambiar servicio no modifica el alto del panel ni recalcula el encuadre con una
  recta provisional. Mapa cenital bloqueado: sin arrastre, zoom o giro. Se encuadra
  la geometría completa y se estabiliza la colocación de etiquetas. El formulario
  mantiene desplazamiento por accesibilidad en pantallas pequeñas y con letra grande.
- Verificar caché/cancelación, ETA/GPS/errores, rutas, cambios de servicio,
  tipos, lint, pantallas y bundle Android. Actualizar evidencia y presentación.

Fuentes: [Expo Location 56](https://docs.expo.dev/versions/v56.0.0/sdk/location/),
[Google routing preferences](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RoutingPreference),
[computeRoutes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes).


## Resultado y evidencia

- **Cierre del conductor:** `actualizarTrasCalificacion` espera que terminen las
  cancelaciones locales antes de limpiar activo/pendiente. La pantalla no vuelve
  a cancelar esas consultas tras guardar la calificación. La regresión anterior
  falla con `error !== success`; después pasa y Solicitudes se abre directamente.
  Las invalidaciones posteriores siguen en segundo plano, sin esperar otra red.
- **ETA automática:** los cinco caminos de oferta/reoferta consultan una posición
  actual (máximo 30 s y precisión de hasta 200 m), calculan conductor → recogida
  y redondean la duración hacia arriba. Se elimina el campo de minutos manuales.
  Permiso denegado, GPS desactivado/antiguo/impreciso y ausencia de ruta impiden
  publicar una ETA inventada. El mismo cálculo respeta moto para encomiendas
  cuando ese es el vehículo activo del conductor.
- **Rutas:** Google recibe `TRAFFIC_AWARE_OPTIMAL`, alternativas y polilínea de alta
  calidad. Se valida cada alternativa y se elige menor tiempo; distancia desempata.
  El cache se comparte por modo de vehículo y coordenadas: taxi/encomienda/mudanza
  reutilizan `DRIVE`, moto conserva `TWO_WHEELER`. Al cambiar perfil se conserva
  temporalmente la geometría de los mismos extremos con «Actualizando ruta…».
  No se dibuja una línea recta como si fuera una ruta calculada.
- **Mapa:** configuración tiene un área propia, panel de alto estable y etiquetas
  A/B editables fuera de la cámara. Los mapas con ruta bloquean arrastre, giro y
  zoom; el encuadre considera toda la geometría, también si cambia sin variar su
  número de puntos. El selector de servicios usa dos columnas sin desbordamiento.
  El formulario puede desplazarse para acceder a todos los controles con letra grande.

**Comprobaciones del 19/09/2026:**

- **329 pruebas móviles aprobadas**; TypeScript y lint sin errores ni advertencias.
- **25 casos de interfaz:** diez envíos de ETA (cinco caminos × taxi/moto), dos cierres
  con consultas antiguas pendientes, un error GPS con reintento y doce cambios de
  servicio (cuatro servicios × tres configuraciones de tamaño/tema/escala de texto).
  Etiquetas y CTA conservan exactamente sus rectángulos entre servicios. Se probaron
  390×844 y 320×640, temas claro/oscuro y texto hasta 200 %. Sin errores JavaScript.
- **Google Routes real:** HTTP 200 para `DRIVE` y `TWO_WHEELER`, con tres alternativas
  por modo, sobre coordenadas sintéticas de La Paz. Se registran tiempos, distancias
  y cantidad de puntos; no claves. Comprueba compatibilidad del proveedor y la
  configuración actual, no una garantía de tráfico futuro ni restricciones de camiones.
- **Android:** bundle completo HTTP 200, **11.893.148 bytes**. API `/health/ready` y
  Metro sanos. No se reiniciaron servicios, no se cambió el backend ni la base.
- **Plan/presentación:** revisión 14. Las cifras backend de la revisión 13 permanecen
  como evidencia anterior; esta corrección afecta mobile y no las vuelve a atribuir
  a una nueva ejecución.

Evidencia local: `local-files/automatic-arrival-route-2026-09-19/`.
El visor conserva pantallas, hooks, React Query y la lógica de rutas; sustituye
GPS/HTTP/navegación y el mapa nativo por un visor de encuadre. Las consultas a Google
son una comprobación independiente. Sigue pendiente validar en los teléfonos del
usuario el GPS real, el render Google Maps y el teclado nativo con esta versión.
