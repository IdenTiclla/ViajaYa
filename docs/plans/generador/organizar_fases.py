"""Convierte la revisión 4 en un plan por fases, conservando su especificación."""
from pathlib import Path
import ast
import json
import re

BASE = Path(__file__).resolve().parents[1]
ruta = BASE / 'plan-salida-produccion.md'
anterior = ruta.read_text(encoding='utf-8')
assert '## 2. Trabajo pendiente, en orden de ejecución' in anterior, 'La reorganización ya fue aplicada.'

fases = [
    dict(numero=1, titulo='Base técnica y tres entornos', depende='Ninguna; punto de inicio.',
         objetivo='Preparar una base reproducible y la separación de desarrollo, pruebas y producción antes de añadir funcionalidades.',
         prs=['F01-A · Configuración validada de los tres entornos y ejemplos sin secretos.',
              'F01-B · Variantes Android, identidades y destinos de API separados.',
              'F01-C · Imágenes reproducibles, CI y contratos de proveedores simulados.'],
         cierre='Desarrollo funciona de forma reproducible; CI comprueba aislamiento y rechazo de configuraciones inseguras. Las variantes y definiciones de despliegue de pruebas/producción quedan preparadas; su alojamiento se verifica antes de cerrar F09.',
         evidencia='Arranque documentado en Windows, validación de configuraciones válidas/inválidas, tokens cruzados rechazados y builds identificables. Ningún secreto se incorpora al repositorio.',
         costo='Puede comenzar localmente sin contratar nube ni SMS. Preparar despliegues no significa que ya existan tres entornos alojados.'),
    dict(numero=2, titulo='Teléfono, OTP y cuentas sociales', depende='F01.',
         objetivo='Permitir entrar o registrarse con teléfono y OTP, con Google/Facebook opcionales y recuperación sin bloqueos.',
         prs=['F02-A · Identidad estable, desafío OTP y autofill simulado en entornos bajos.',
              'F02-B · Flujo móvil unificado, sesiones y recuperación de acceso.',
              'F02-C · Google/Facebook, vinculación y migración de cuentas existentes.'],
         cierre='Alta, acceso y recuperación funcionan sin cuentas duplicadas ni cambios de rol. Desarrollo/pruebas hacen cero llamadas al proveedor OTP; producción rechaza la simulación. La entrega SMS real se certifica en F09.',
         evidencia='OTP incorrecto, vencido y reutilizado; reenvíos; pérdida de sesión; altas concurrentes; vinculación social y migración conservando ID, rol e historial. Ausencia de codigo_prueba en el contrato productivo.',
         costo='OTP de desarrollo/pruebas: cero cargos externos. Las cuentas OAuth y el adaptador real se preparan aquí; reservar presupuesto para certificar SMS productivo en F09.'),
    dict(numero=3, titulo='Países, panel base y feature flags', depende='F01–F02.',
         objetivo='Controlar el acceso administrativo y la disponibilidad por territorio, dejando preparada la expansión internacional.',
         prs=['F03-A · País, zona, moneda y horario; Bolivia como configuración inicial.',
              'F03-B · Panel base con acceso reforzado, roles y auditoría.',
              'F03-C · Flags de backend y capacidades consumidas por la app.'],
         cierre='Una zona y sus servicios pueden habilitarse con permisos y auditoría. Desactivar una función impide nuevas operaciones y conserva las activas. La estructura admite otro país sin mezclar monedas.',
         evidencia='Permisos por rol y zona, importes decimales, horarios, teléfonos internacionales y flags apagadas durante un viaje activo. Los módulos operativos y financieros se completan en F04 y F07.',
         costo='Puede desarrollarse con datos sintéticos y panel local; el catálogo no activa comercialmente ningún país nuevo.'),
    dict(numero=4, titulo='Conductores y operación del viaje', depende='F02–F03.',
         objetivo='Habilitar conductores aprobados y resolver la operación normal y excepcional del viaje desde app y panel.',
         prs=['F04-A · Alta, documentos privados, revisión y suspensión del conductor.',
              'F04-B · Elegibilidad, disponibilidad, cobertura y recogida verificada.',
              'F04-C · Cancelaciones, incidentes y herramientas de soporte auditadas.'],
         cierre='Solo conductores aprobados y elegibles reciben solicitudes; soporte resuelve incidentes sin editar la base de datos y se limita la información expuesta antes de asignar.',
         evidencia='Documento vencido, suspensión, conductor fuera de zona, cancelación, ausencia e incidente. Matching conserva asignación atómica y reglas actuales.',
         costo='El software puede probarse localmente. La apertura necesitará personas para revisión de documentos, soporte y operación.'),
    dict(numero=5, titulo='Seguimiento, mapas y notificaciones', depende='F04.',
         objetivo='Mantener ubicación y estado del viaje confiables para pasajero y conductor, con mapas y consumo controlados.',
         prs=['F05-A · Reporte GPS autorizado, precisión y aviso de ubicación antigua.',
              'F05-B · Continuidad Android, recuperación realtime y notificaciones.',
              'F05-C · Maps/Places/Routes desde backend, errores, cuotas y métricas.'],
         cierre='El seguimiento se recupera tras desconexión, segundo plano y cambio de app; conserva ofertas de 30 segundos y presencia del pasajero de 120 segundos.',
         evidencia='Dos teléfonos, permisos denegados, GPS antiguo, red lenta, reconexión y push que recupera el snapshot. La cancelación por ausencia solo afecta SEARCHING.',
         costo='Usar dobles en automatización y limitar ensayos reales de mapas. No confundir OTP gratuito en entornos bajos con gratuidad de Google Maps.'),
    dict(numero=6, titulo='Navegación del conductor', depende='F05; la prueba de compatibilidad nativa puede adelantarse a F01.',
         objetivo='Guiar dentro de ViajaYa hacia recogida y destino con Google Navigation, manteniendo Waze como opción externa.',
         prs=['F06-A · Validar wrapper, Expo 56 y build Android reproducible.',
              'F06-B · Guía integrada, voz, ETA, desvíos y cambio de etapa.',
              'F06-C · Recuperación, Waze opcional y medición de solicitudes cobrables.'],
         cierre='Un recorrido real completa las dos etapas con guía integrada, una sola voz y seguimiento del pasajero. La llegada del SDK no completa el viaje ni su pago; no hay solicitudes duplicadas por render o reconexión.',
         evidencia='Taxi, moto y encomienda en zonas objetivo; GPS/red/credenciales fallidos, Bluetooth, pantalla bloqueada, Waze instalado/ausente y regreso a la etapa correcta.',
         costo='La prueba real necesita cuenta Google y presupuesto limitado. Si la integración beta no es compatible, resolver el bloqueo antes de comprometer la funcionalidad; no sustituirla silenciosamente por Waze.'),
    dict(numero=7, titulo='Cobros, comisiones y liquidaciones', depende='F03–F04; puede avanzar en paralelo con F05–F06. Sandbox y contrato del proveedor para cerrar la integración.',
         objetivo='Registrar y conciliar QR y efectivo, con comisiones, deuda del conductor y liquidaciones trazables.',
         prs=['F07-A · Importes, comisión congelada, registro contable y efectivo.',
              'F07-B · QR, verificación del proveedor, webhooks e idempotencia.',
              'F07-C · Deuda, devoluciones, conciliación, liquidaciones y panel financiero.'],
         cierre='Cada importe se explica desde el servicio hasta el cobro, comisión y liquidación tras reintentos o caídas. La integración QR supera el sandbox del proveedor; los cobros reales se certifican en F09.',
         evidencia='Notificaciones duplicadas/tardías, QR vencido, efectivo disputado, límites de deuda, devolución y liquidación fallida; conciliación sin duplicar dinero.',
         costo='Modelo y adaptadores simulados pueden avanzar sin contrato. Cotizar comisión de pasarela, devoluciones y liquidaciones antes de cerrar la integración.'),
    dict(numero=8, titulo='Encomiendas completas', depende='F04–F07 para cerrar el recorrido completo; formularios y estados pueden adelantarse.',
         objetivo='Completar retiro, transporte, entrega y resolución de excepciones de paquetes con trazabilidad operativa y financiera.',
         prs=['F08-A · Remitente, destinatario, paquete y restricciones.',
              'F08-B · Retiro, entrega y comprobación de recepción.',
              'F08-C · Ausencias, devoluciones e incidentes con ajustes auditados.'],
         cierre='Una encomienda se entrega o resuelve excepcionalmente desde app y panel; quedan registrados estado, comprobación, responsabilidad e importes aplicables.',
         evidencia='Retiro correcto, código de entrega incorrecto/reutilizado, destinatario ausente, devolución y ajuste de cobro autorizado.',
         costo='Validar condiciones, artículos restringidos, responsabilidad y operación de devoluciones con el frente comercial antes de abrir.'),
    dict(numero=9, titulo='Certificación productiva y cumplimiento', depende='F01–F08 y disponibilidad de presupuesto/proveedores. Aprovisionar pruebas antes de los ensayos que lo requieran.',
         objetivo='Certificar el candidato completo en infraestructura alojada y comprobar seguridad, recuperación, costos y cumplimiento.',
         prs=['F09-A · Infraestructura alojada, promoción, migraciones y observabilidad.',
              'F09-B · Integración, aislamiento, carga, restauración y rollback.',
              'F09-C · Privacidad, eliminación y certificación real de proveedores.'],
         cierre='Pruebas y producción están alojados y aislados; el candidato supera integración, carga y recuperación. OTP/OAuth/QR/Navigation reales, condiciones comerciales, privacidad y presupuesto de apertura tienen evidencia.',
         evidencia='Informe de la matriz de certificación, alerta recibida, restauración RPO ≤ 15 min/RTO ≤ 2 h, API p95 ≤ 500 ms y realtime p95 ≤ 2 s bajo la carga objetivo; ensayo de eliminación y retención.',
         costo='Requiere gasto real en hosting y ensayos acotados de proveedores. Con presupuesto cero esta fase no se declara completa ni se abre al público.'),
    dict(numero=10, titulo='Google Play y apertura gradual', depende='F09. La cuenta Play y preparación de la ficha pueden adelantarse.',
         objetivo='Publicar el AAB certificado y abrir zonas de Bolivia con taxi, moto y encomiendas operativos y bajo seguimiento.',
         prs=['F10-A · AAB firmado, ficha, Data Safety, permisos y revisión de Play.',
              'F10-B · Prueba interna/cerrada aplicable e instalación/actualización.',
              'F10-C · Apertura por zonas, soporte, conciliación y revisión de métricas.'],
         cierre='Google Play acepta el binario; se promueve el mismo AAB productivo certificado. Cada zona habilitada tiene conductores aprobados, soporte, conciliación, alertas y límites de gasto activos.',
         evidencia='Registro de aprobación y versión, resultados en teléfonos, checklist de zona, responsables de incidencias y seguimiento de errores, pagos y costo por servicio.',
         costo='Abrir gradualmente por geografía contiene exposición y gasto; los tres servicios acordados deben estar listos. Expandir países requiere una certificación independiente.'),
]

cabecera, resto = anterior.split('## 2. Trabajo pendiente, en orden de ejecución\n', 1)
trabajo, transversal = resto.split('## 3. Contratos y compatibilidad\n', 1)
partes = re.split(r'^\*\*(\d+)\. [^\n]+\*\*\n', trabajo, flags=re.M)
frentes = {int(partes[i]): partes[i+1].strip() for i in range(1, len(partes), 2)}
assert set(frentes) == set(range(1, 11))

def sin_cierre(texto):
    return re.sub(r'^\*\*Criterio de cierre[^\n]*\n?', '', texto, flags=re.M).strip()

infra, entornos = frentes[9].split('**Tres entornos, tres propósitos**', 1)
entornos, promocion = entornos.split('**Promoción de versiones: desarrollo → pruebas → producción**', 1)
gps, navegacion = frentes[6].split('**Navegación del conductor dentro de ViajaYa**', 1)
privacidad = '\n'.join(linea for linea in frentes[10].splitlines() if linea.startswith('- ') and not any(k in linea for k in ('Data Safety', 'AAB firmado', 'prueba cerrada')))
tienda = '\n'.join(linea for linea in frentes[10].splitlines() if linea.startswith('- ') and any(k in linea for k in ('Data Safety', 'AAB firmado', 'prueba cerrada')))

panel_base = frentes[3].replace('Crear un panel web interno para:', 'Crear la estructura del panel web interno y completar ahora países, zonas y permisos:')
panel_base = panel_base.replace('- Revisar conductores, documentos y vehículos.\n', '')
panel_base = panel_base.replace('- Consultar viajes, incidentes, cobros, liquidaciones y comisiones pendientes.\n', '')
panel_base = panel_base.replace('- Resolver operaciones excepcionales mediante acciones auditadas.\n', '')
panel_base = panel_base.replace('- Consultar indicadores de operación y gasto.', '- Preparar el contrato de indicadores; conectar operación en F04–F05 y gasto/finanzas en F07–F09.')
contenido = {
    1: '**Tres entornos, tres propósitos**\n\n' + entornos.strip() + '\n\n**Preparación técnica inicial**\n\n- Crear imágenes y dependencias reproducibles, controles de CI y contratos de configuración de los proveedores. Preparar el modo OTP simulado exclusivamente para desarrollo/pruebas; su flujo y autofill se implementan en F02.\n- Declarar infraestructura, URLs, secretos requeridos y promoción sin contratar ni aprovisionar automáticamente servicios de pago. No crear un cuarto entorno.\n- Registrar la prueba anticipada de compatibilidad Google Navigation/Expo 56 como tarea F06-A si conviene despejar ese riesgo temprano.\n\nEl aislamiento se construye desde F01 y se mantiene en cada fase. La promoción completa se ejecuta y certifica en F09; no se posterga hasta entonces la separación de datos o credenciales.',
    2: sin_cierre(frentes[2]),
    3: '**Territorios y moneda**\n\n' + sin_cierre(frentes[4]) + '\n\n**Panel base y capacidades**\n\n' + panel_base,
    4: frentes[5] + '\n\n**Módulo operativo del panel**\n\n- Revisar conductores, documentos y vehículos.\n- Consultar viajes e incidentes y resolver operaciones excepcionales mediante acciones auditadas. Los cobros, liquidaciones y comisiones pendientes se incorporan en F07.\n- Conectar indicadores operativos y el procedimiento de atención humana.',
    5: gps.strip() + '\n\n- Conservar WebSocket como vía principal, recuperación por snapshot y polling como respaldo lento. La cancelación automática por ausencia solo afecta viajes SEARCHING; el GPS del conductor no modifica esta regla.',
    6: '**Navegación del conductor dentro de ViajaYa**\n\n' + sin_cierre(navegacion),
    7: sin_cierre(frentes[7]) + '\n\n**Módulo financiero del panel**\n\n- Consultar cobros, liquidaciones y comisiones pendientes con permisos de finanzas.\n- Resolver diferencias, reclamos y ajustes mediante acciones auditadas; conectar indicadores de operación y gasto.\n- Construir primero efectivo y registro contable, después QR y por último conciliación/deuda/liquidaciones; mantener contratos backend/mobile en cada PR.',
    8: sin_cierre(frentes[8]),
    9: infra.strip().replace('definidos a continuación', 'definidos en F01 y en el flujo siguiente') + '\n\n**Promoción de versiones: desarrollo → pruebas → producción**\n\n' + sin_cierre(promocion) + '\n\n**Privacidad y certificación de proveedores**\n\n' + privacidad + '\n- Ejecutar la matriz completa de la sección 5 y registrar evidencia del candidato, entorno y versión. La instalación/revisión final de Google Play se cierra en F10.\n- Certificar OTP real exclusivamente en producción mediante un ensayo acotado y presupuestado; desarrollo/pruebas mantienen siempre la simulación. Certificar OAuth con firmas productivas y QR real con su proveedor.\n- Confirmar costos medidos, responsables, contratos y límites antes de autorizar la apertura.',
    10: tienda + '\n\n- Promover el mismo AAB productivo certificado internamente; cambiar de pista no cambia la API del binario.\n- Abrir zonas gradualmente mediante flags, con taxi, moto y encomiendas listos, conductores aprobados, soporte y conciliación disponibles.\n- Observar errores, disponibilidad, pagos y costo por servicio; si se detiene una apertura, bloquear nuevas operaciones conservando viajes y obligaciones en curso.\n- Ampliar cobertura o capacidad según estabilidad, demanda y costo observado. Un país nuevo lleva su propia certificación local.',
}

salida = [cabecera.strip(), 'Revisión 5: diez fases de implementación con dependencias, PR sugeridos, evidencia y criterios de cierre. Esta revisión reorganiza el trabajo; no marca funcionalidades como implementadas.',
          '## 2. Hoja de ruta por fases',
          'Cada fase produce una entrega revisable. Los PR sugeridos ordenan unidades de implementación, no representan ramas o PR ya creados. Todos los estados empiezan en **Pendiente**; la base existente se reutiliza y se verifica. Una fase solo se cierra con su criterio y evidencia, aunque parte del código ya exista.',
          '| Fase | Entrega | Dependencias para cerrar | Estado |\n|---|---|---|---|\n' + '\n'.join(f'| F{f["numero"]:02d} | {f["titulo"]} | {f["depende"]} | Pendiente |' for f in fases),
          '**Secuencia principal:** F01 → F02 → F03 → F04 → F05 → F06 → F08 → F09 → F10. F07 parte de F03–F04, puede avanzar junto a F05–F06 y también debe terminar antes de F08. Con una sola persona, usar el orden numérico F01–F10.',
          '**Trabajo anticipable:** preparar cuentas, requisitos de Play y cotizaciones desde F01; adelantar F06-A para comprobar compatibilidad nativa; aprovisionar pruebas cuando haya presupuesto, antes de cualquier certificación que requiera ese entorno. La infraestructura alojada se certifica en F09. Estas tareas conservan el número de su fase y no alteran sus dependencias de cierre.',
          '**Cómo ejecutar y dar seguimiento**\n\n- Tomar una fase y su primer PR pendiente, revisar el código existente y concretar su contrato antes de editar. Si cruza backend/mobile, actualizar ambos y sus pruebas juntos.\n- Mantener por fase: estado (Pendiente / En curso / Bloqueada / Completada), responsable, enlaces a PR, evidencia, costo observado y bloqueos. No dar por cerrada una fase por haber fusionado código solamente.\n- Cerrar con pruebas proporcionales, migraciones revisadas, demostración del recorrido y riesgos resueltos. F09 reúne la certificación del sistema completo.\n- No fijar fechas sin disponibilidad de equipo ni proveedores. Un bloqueo externo impide el cierre correspondiente, pero permite seguir con tareas independientes autorizadas.',
          '### Trabajo comercial y operativo en paralelo',
          'Empieza junto con F01 y no impide preparar el proyecto localmente. Las condiciones/sandbox QR son requisito de cierre de F07; presupuesto, permisos, responsables y proveedores reales son requisitos de F09–F10.',
          sin_cierre(frentes[1])]
for f in fases:
    n = f['numero']
    salida.extend([
        f'### Fase {n:02d}. {f["titulo"]}',
        '**Estado:** Pendiente. **Responsable:** por asignar. **PR y evidencia:** por registrar.',
        '**Objetivo:** ' + f['objetivo'],
        '**Dependencias:** ' + f['depende'],
        '**Entregas en orden:**\n\n' + '\n'.join('- [ ] ' + p for p in f['prs']),
        '**Alcance y decisiones técnicas**\n\n' + contenido[n],
        '**Comprobación y evidencia:** ' + f['evidencia'],
        '**Criterio de cierre de F%02d:** %s' % (n, f['cierre']),
        '**Costo o dependencia externa:** ' + f['costo'],
    ])
salida.extend([
    '### Primer bloque para empezar: F01-A',
    '- [ ] Inventariar la configuración actual de backend, mobile, Docker y EAS; identificar valores fijos y documentación activa. Usar ejemplos sin leer ni modificar secretos de los archivos .env.\n- [ ] Definir el contrato de entorno y su validación: desarrollo/pruebas/producción, URLs, emisor/audiencia, credenciales por proveedor y modos permitidos.\n- [ ] Documentar la matriz OTP: simulación obligatoria en desarrollo/pruebas, proveedor real exclusivamente en producción; el autofill llega en F02.\n- [ ] Actualizar configuración y ejemplos de ambos proyectos y comprobar aceptación de combinaciones válidas y rechazo de cruces/modos inseguros.\n- [ ] Adjuntar evidencia del PR y continuar con F01-B. Este bloque no contrata nube ni requiere activar SMS.',
    '## 3. Contratos y compatibilidad\n\n' + transversal.strip(),
])
nuevo = '\n\n'.join(salida) + '\n'
nuevo = nuevo.replace('Ejecutar los bloques anteriores mediante PR separados, con sus pruebas y criterios de cierre. Preparar proveedores y configuración comercial en paralelo con seguridad y panel; integrar pagos y encomiendas antes de certificar el lanzamiento completo.', 'Ejecutar cada fase mediante los PR sugeridos y comprobar sus criterios antes de cerrarla. La siguiente matriz es transversal: cada comportamiento se prueba en su fase, se certifica integrado en F09 y se confirma para publicación en F10.')

# Conservar una referencia local para revisar que no se hayan perdido requisitos ni fuentes.
(BASE / '.build' / 'plan-revision-4.md').write_text(anterior, encoding='utf-8')
(BASE / '.build' / 'fases.json').write_text(json.dumps(fases, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
ruta.write_text(nuevo, encoding='utf-8')
print(json.dumps({'fases': len(fases), 'entregas': sum(len(f['prs']) for f in fases), 'archivo': str(ruta)}, ensure_ascii=False))
