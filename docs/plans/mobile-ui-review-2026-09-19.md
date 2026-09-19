# Mejoras de UI móvil y correcciones — 19/09/2026

Rama de trabajo: `codex/ui-improvements-and-bugfixes`, creada desde `main`
(`986dd79`). Los cambios locales previos del plan de producción y de su
presentación HTML se conservaron íntegros al cambiar de rama. Esta entrega
permanece local, sin commit ni push.

## Cambios realizados

- **Acceso por teléfono:** pegar un número con `+` o `00` reconoce el prefijo
  internacional y selecciona un país habilitado. Se evita duplicar el prefijo,
  se conserva como inválido un país no admitido y no se trunca silenciosamente
  un número demasiado largo. El país inicial respeta el catálogo del servidor.
- **Selector de país:** áreas táctiles de al menos 48 puntos, texto adaptable,
  estado seleccionado accesible y error junto al campo. El servidor sigue
  validando las reglas de numeración de cada país.
- **OTP:** pegar seis dígitos separados por espacios conserva el código completo.
  La pantalla distingue un código solicitado, uno enviado y uno simulado; ya no
  anuncia un envío que todavía no ocurrió.
- **Registro de conductor:** secciones de vehículo, servicios y datos; errores
  de placa/modelo junto a sus campos; confirmación y errores desplazables.
  Volver y cambiar de vehículo se deshabilitan durante el guardado. Un bloqueo
  inmediato evita envíos repetidos antes de actualizar el estado visual.
- **Selección de servicios:** volver a tocar el vehículo seleccionado ya no
  restablece todos sus servicios. Los datos permanecen disponibles para reintentar
  tras un fallo de registro.
- **Estados del registro:** carga con salida, reintento visible, cupo completo y
  enlace de edición no disponible. Registrar el último tipo de vehículo conserva
  su confirmación después de actualizar la lista.
- **Mensajes compartidos:** el modo compacto de `FeedbackState` conserva la
  altura necesaria para su texto, evitando solapar el botón siguiente al ampliar
  la tipografía. El modo expandido mantiene su comportamiento anterior.

## Verificación

| Comprobación | Resultado |
|---|---|
| `cd mobile && npm test` | **283 pruebas aprobadas**, sin fallos ni omitidas; incluye 8 regresiones nuevas de entrada telefónica. |
| `cd mobile && ./node_modules/.bin/tsc --noEmit` | Aprobado. |
| `cd mobile && EXPO_NO_DOTENV=1 npm run lint` | Aprobado. |
| `git diff --check` | Aprobado. |
| Componentes reales compilados con Metro para React Native Web | Teléfono internacional, selección de país, OTP formateado, selección repetida, guardado, reintento, edición y estados del registro aprobados. Sin errores JavaScript. |
| Geometría en Chromium | 32 combinaciones: acceso/registro/error/cupo completo × 320/390 px × claro/oscuro × texto 100/200 %. Sin desbordamiento horizontal; mensajes sin solapamiento; última acción alcanzable mediante desplazamiento. |

El visor de UI sustituyó los hooks de red y navegación por datos simulados;
usó los componentes de presentación y los controladores de teléfono reales.
La escala de texto se simuló en React Native Web. Se inspeccionaron también las
capturas, lo que permitió detectar y corregir el solapamiento de los mensajes.

Evidencia local, excluida de Git: `local-files/mobile-ui-review-2026-09-19/`
(capturas, resultados de interacción y log de pruebas). El visor y su script de
comprobación se generaron en `/tmp/viajaya-mobile-ui-review/`; no son una nueva
aplicación ni una dependencia del producto.

## Límites y cierre pendiente

Esta comprobación no certifica teclado, TalkBack, autofill ni navegación nativa
en un dispositivo Android. Falta recorrer acceso y registro con el dev build,
texto grande, teclado abierto y una conexión real. No se generó un APK nuevo.
No hubo cambios en contratos HTTP/WebSocket, backend, secretos ni servicios.

Los **275 tests móviles** del informe de preparación para producción siguen
siendo la evidencia de la base `main` revisada antes de estas correcciones;
los **283** corresponden a esta rama de trabajo. Las fases F02 y F04 mantienen
sus pendientes y criterios de cierre del [plan de producción](plan-salida-produccion.md).
