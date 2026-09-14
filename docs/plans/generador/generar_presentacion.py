from pathlib import Path
import html
import json
import re

BASE = Path(__file__).resolve().parents[1]
plan = (BASE / 'plan-salida-produccion.md').read_text(encoding='utf-8')
fases = json.loads((BASE / '.build' / 'fases.json').read_text(encoding='utf-8'))
fase_actual = None
for fase_plan in fases:
    assert f"### Fase {fase_plan['numero']:02d}. {fase_plan['titulo']}" in plan


def en_linea(texto):
    texto = html.escape(texto)
    texto = re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)', r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', texto)
    texto = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', texto)
    return re.sub(r'`([^`]+)`', r'<code>\1</code>', texto)


def markdown(texto):
    salida, lista, tabla = [], False, False
    for linea in texto.splitlines():
        if lista and not linea.startswith('- '):
            salida.append('</ul>'); lista = False
        if tabla and not linea.startswith('|'):
            salida.append('</tbody></table></div>'); tabla = False
        if not linea.strip():
            continue
        if linea.startswith('|'):
            if re.match(r'^\|[\s:|\-]+$', linea):
                continue
            celdas = [en_linea(x.strip()) for x in linea.strip('|').split('|')]
            if not tabla:
                salida.append('<div class="table-wrap"><table><thead><tr>' + ''.join('<th>' + x + '</th>' for x in celdas) + '</tr></thead><tbody>'); tabla = True
            else:
                salida.append('<tr>' + ''.join('<td>' + x + '</td>' for x in celdas) + '</tr>')
        elif linea.startswith('- '):
            if not lista:
                salida.append('<ul>'); lista = True
            salida.append('<li>' + ('<span aria-label="Completado">☑</span> ' + en_linea(linea[6:]) if linea.startswith('- [x] ') else '<span aria-label="Pendiente">☐</span> ' + en_linea(linea[6:]) if linea.startswith('- [ ] ') else en_linea(linea[2:])) + '</li>')
        elif linea.startswith('#'):
            nivel = len(linea) - len(linea.lstrip('#'))
            salida.append(f'<h{nivel}>' + en_linea(linea[nivel:].strip()) + f'</h{nivel}>')
        elif re.match(r'^\*\*\d+\. .+\*\*$', linea):
            salida.append('<h3>' + en_linea(linea.strip('*')) + '</h3>')
        else:
            salida.append('<p>' + en_linea(linea) + '</p>')
    if lista: salida.append('</ul>')
    if tabla: salida.append('</tbody></table></div>')
    return '\n'.join(salida)


diapositivas = []


def slide(titulo, cuerpo, clase='', etiqueta='PLAN DE PRODUCCIÓN'):
    numero = len(diapositivas) + 1
    if fase_actual is not None:
        etiqueta = f"FASE {fase_actual['numero']:02d} · {fase_actual.get('estado', 'Pendiente').upper()}"
    titulo_selector = (f"F{fase_actual['numero']:02d} · " if fase_actual else '') + titulo
    diapositivas.append(f'<section class="slide {clase}" id="slide-{numero}" aria-labelledby="titulo-{numero}" data-title="{html.escape(titulo_selector, quote=True)}"><div class="slide-inner"><header><p class="eyebrow">{etiqueta}</p><h2 id="titulo-{numero}" tabindex="-1">{titulo}</h2></header><div class="slide-body">{cuerpo}</div><footer><span>ViajaYa · Bolivia / expansión internacional</span><span>{numero:02d}</span></footer></div></section>')


def puntos(items):
    return '<ul class="puntos">' + ''.join('<li>' + en_linea(x) + '</li>' for x in items) + '</ul>'


def detalle(num, titulo, items, cierre, nota=''):
    num = fase_actual['numero']
    slide(titulo, '<div class="frente"><div class="numero-frente">' + f'{num:02d}' + '<span>DETALLE DE LA FASE</span></div><div>' + puntos(items) + '</div></div><p class="criterio"><strong>Resultado esperado</strong> ' + en_linea(cierre) + '</p>' + (f'<p class="fuente">{nota}</p>' if nota else ''))


def fase(numero):
    global fase_actual
    fase_actual = fases[numero - 1]
    f = fase_actual
    slide(f['titulo'], '<p class="intro small">' + en_linea(f['objetivo']) + '</p><div class="frente"><div class="numero-frente">' + f'{numero:02d}' + '<span>FASE · ' + en_linea(f.get('estado', 'Pendiente').upper()) + '</span></div><div>' + puntos(f['prs']) + '</div></div><p class="criterio"><strong>Cierre</strong> ' + en_linea(f['cierre']) + '</p><p class="fuente"><strong>Depende de:</strong> ' + en_linea(f['depende']) + '</p>')


slide('ViajaYa<br>Salida a producción', '<p class="lead">El trabajo pendiente para abrir en Bolivia<br>y preparar la expansión a otros países.</p><p class="cover-meta">Android · Taxi, moto y encomiendas</p><p class="cover-date">9 de septiembre de 2026 · Revisión 6 · F01 completada y verificada localmente</p>', 'cover', 'HOJA DE RUTA')

slide('Alcance del lanzamiento', '<p class="intro">Apertura pública por zonas, con cobro al finalizar y operación administrada.</p><div class="stats"><div><strong>500</strong><span>conductores conectados</span></div><div><strong>5.000</strong><span>servicios diarios</span></div><div><strong>3</strong><span>servicios: taxi, moto y encomiendas</span></div></div><div class="triple"><div><h3>Dinero</h3><p>QR + efectivo, comisión por servicio y liquidaciones. Sin saldo recargable.</p></div><div><h3>Control</h3><p>Panel administrativo, permisos, auditoría y feature flags por zona.</p></div><div><h3>Expansión</h3><p>País, moneda, horario y proveedores configurables. Bolivia primero.</p></div></div><p class="fuente">Las cifras son metas de capacidad por comprobar; no representan uso actual ni una contratación inicial obligatoria.</p>')

slide('Lo que ya existe y lo que falta', '<div class="two-col"><div><h3>Base implementada</h3>' + puntos(['Negociación y asignación atómica.', 'Ciclo del viaje, historial y calificaciones.', 'WebSockets, Redis y outbox durable.', 'Pruebas automatizadas y contratos.']) + '</div><div><h3>Bloqueos para lanzar</h3>' + puntos(['Seguridad y gestión completa de cuentas.', 'GPS real, alta de conductores y soporte.', 'Pagos, comisiones y encomiendas completas.', 'Infraestructura, privacidad y certificación.']) + '</div></div><p class="criterio"><strong>Prioridad</strong> Completar el servicio comercial y certificar la base técnica existente.</p>')

slide('Diez fases para implementar', '<div class="agenda">' + ''.join(f'<div><span>{f["numero"]:02d}</span><p>{f["titulo"]}</p></div>' for f in fases) + '</div><p class="fuente">F01 verificada · F02–F10 pendientes · 30 entregas planificadas · Cada fase tiene dependencias, comprobaciones y criterio de cierre.</p>')

slide('Orden y trabajo en paralelo', '<div class="timeline"><div><span>01–04</span><h3>Base y operación</h3><p>Entornos → acceso → países y panel → conductores.</p></div><div><span>05–08</span><h3>Servicio completo</h3><p>Seguimiento → navegación. Pagos puede avanzar en paralelo; ambos deben estar listos para cerrar encomiendas.</p></div><div><span>09–10</span><h3>Certificar y abrir</h3><p>Infraestructura, proveedores y cumplimiento → Google Play y apertura por zonas.</p></div></div><p class="criterio"><strong>Con una persona</strong> Seguir F01–F10. Adelantar la prueba de compatibilidad de Navigation y preparar proveedores desde el inicio.</p>')

slide('Proveedores y operación en paralelo', '<div class="two-col"><div><h3>Empezar junto con F01</h3>' + puntos(['Definir zonas, servicios y responsables.', 'Revisar condiciones locales, seguros y contratos.', 'Preparar cuentas, dominio y Google Play.', 'Cotizar hosting, OTP, Google y pasarela QR.']) + '</div><div><h3>Cuándo se necesitan</h3>' + puntos(['F06: cuenta y presupuesto limitado para Navigation real.', 'F07: condiciones y sandbox de la pasarela.', 'F09: presupuesto, contratos y proveedores reales certificados.', 'F10: conductores, soporte y conciliación por zona.']) + '</div></div><p class="criterio"><strong>Primer paso viable</strong> F01 comienza localmente sin contratar nube ni SMS. Las gestiones externas no bloquean el trabajo independiente.</p>')

fase(1)

slide('Tres entornos separados', '<div class="triple"><div><h3>Desarrollo</h3>' + puntos(['En la computadora del desarrollador.', 'Datos ficticios y servicios locales.', 'Pagos simulados; OTP autocompletado sin SMS.', 'ViajaYa Desarrollo · perfil development.']) + '</div><div><h3>Pruebas</h3>' + puntos(['Alojado y restringido al equipo y testers.', 'QA del candidato, integración y recuperación.', 'Pasarela sandbox; OTP autocompletado sin SMS.', 'ViajaYa Pruebas · perfil preview.']) + '</div><div><h3>Producción</h3>' + puntos(['Servicio público y operación real.', 'Datos, cobros, documentos y OTP reales.', 'Backups y monitoreo permanente.', 'ViajaYa · perfil production.']) + '</div></div><p class="criterio"><strong>Aislamiento</strong> Cada entorno tiene su API, base, caché, archivos, secretos, flags y credenciales de proveedores. Pruebas es staging, no un cuarto entorno.</p>')

slide('Qué se entrega ahora y qué requiere nube', '<div class="two-col"><div><h3>F01 · Preparación verificable</h3>' + puntos(['Desarrollo reproducible en Windows.', 'Contrato de entorno, variantes y API separadas.', 'CI y definiciones de despliegue.', 'OTP simulado solo en entornos bajos; flujo en F02.']) + '</div><div><h3>Antes de cerrar F09</h3>' + puntos(['Pruebas y producción realmente alojados.', 'Datos, cuentas, secretos y proveedores aislados.', 'Promoción y recuperación ensayadas.', 'Gasto contratado y proveedores certificados.']) + '</div></div><p class="criterio"><strong>Estado honesto</strong> Tener perfiles y configuración preparados no equivale a tener tres entornos operativos. Aprovisionar pruebas antes de los ensayos que lo requieran.</p>')

fase(2)

slide('Un solo flujo para entrar o registrarse', '<div class="triple"><div><h3>Con teléfono</h3>' + puntos(['Elegir país y número; +591 inicial.', 'Verificar OTP; SMS real solo en producción.', 'Entrar o completar nombre y términos.']) + '</div><div><h3>Con Google o Facebook</h3>' + puntos(['Validar la cuenta social.', 'Solicitar teléfono y OTP si no está verificado.', 'Confirmar la vinculación y completar datos.']) + '</div><div><h3>Al volver</h3>' + puntos(['Conservar la sesión válida.', 'No enviar SMS en cada apertura o viaje.', 'Reverificar al cambiar número, recuperar acceso o por seguridad.']) + '</div></div><p class="criterio"><strong>Migración segura</strong> Mantener ID, historial y rol; no fusionar por correo o teléfono antiguo sin verificar. Retirar el acceso antiguo después de la transición.</p>')

slide('OTP sin costo en entornos bajos', '<div class="triple"><div><h3>Desarrollo y pruebas</h3>' + puntos(['El backend genera un desafío simulado.', 'La app autocompleta el código y lo identifica como prueba.', 'Sin envíos, verificaciones externas ni credenciales SMS.']) + '</div><div><h3>Validación completa</h3>' + puntos(['Continuar verifica el desafío en el backend.', 'Conservar caducidad, límites y uso único.', 'Desactivar autofill para ensayar errores y reenvíos.']) + '</div><div><h3>Producción aislada</h3>' + puntos(['OTP real con el proveedor elegido.', 'No devolver códigos ni aceptar el simulador.', 'El build excluye la ayuda de autocompletado de prueba.']) + '</div></div><p class="criterio"><strong>Costo de proveedor: 0 USD</strong> Aplica a OTP en desarrollo/pruebas; su hosting sigue presupuestado. CI debe comprobar cero llamadas externas y separación de producción.</p>')

fase(3)

detalle(4, 'Bolivia y expansión internacional', [
    'Catálogo de países y zonas; origen y destino validados por el servidor.',
    'Viajes, ofertas, pagos y liquidaciones asociados a zona y moneda.',
    'Importes decimales; no mezclar monedas. Bolivia inicia con BOB.',
    'Fechas en UTC y jornada operativa por zona; Bolivia: America/La_Paz.',
    'Teléfonos internacionales y proveedores/documentos independientes por mercado.'
], 'La estructura admite nuevos países; cada apertura requiere certificación local. iOS, viajes internacionales y cambio de divisas quedan para después.')

slide('Panel base y activación por zona', '<div class="two-col"><div><h3>Entregar en F03</h3>' + puntos(['Acceso reforzado, roles y auditoría.', 'País, zona, servicio y disponibilidad.', 'Flags evaluadas por el backend.', 'La app recibe las capacidades habilitadas.']) + '</div><div><h3>Completar con cada función</h3>' + puntos(['F04: conductores, viajes e incidentes.', 'F07: cobros, deuda y liquidaciones.', 'F05–F09: indicadores de operación y gasto.', 'Flags para acceso social, SMS y navegación.']) + '</div></div><p class="criterio"><strong>Continuidad</strong> Apagar una función bloquea operaciones nuevas y deja terminar viajes y pagos activos. Las flags comerciales no sustituyen el despliegue técnico de Redis/outbox.</p>')

fase(4)

detalle(5, 'Conductores y seguridad del servicio', [
    'Alta con documentos privados, revisión, aprobación, suspensión y vencimientos.',
    'Solicitudes solo para conductores aprobados, disponibles y habilitados.',
    'Pool por cercanía y zona; limitar datos exactos antes de asignar.',
    'Cancelaciones con motivos, ausencias, incidentes y resolución de viajes atascados.',
    'Soporte humano desde viaje e historial, identificación y verificación de recogida.'
], 'Los operadores resuelven incidentes con permisos y auditoría, sin editar la base de datos.')

fase(5)

detalle(6, 'Seguimiento GPS y notificaciones', [
    'Ubicación real del conductor, con hora y precisión, visible solo a participantes.',
    'Detectar señal perdida y posiciones antiguas.',
    'Seguimiento durante el servicio con permisos Android; detenerlo al finalizar.',
    'Push para aceptación, llegada y cancelación; abrir siempre el estado actualizado.',
    'Conservar ofertas de 30 segundos y presencia del pasajero de 120 segundos.'
], 'Seguimiento confiable incluso al minimizar, con pérdida de señal explícita.', '<a href="https://support.google.com/googleplay/android-developer/answer/9799150?hl=en" target="_blank" rel="noopener noreferrer">Política de ubicación de Google Play</a>')

slide('Mapas y control del consumo', '<div class="two-col"><div><h3>Integración confiable</h3>' + puntos(['Places, Routes y geocodificación a través del backend autenticado.', 'Claves separadas para mapa nativo y servicios del servidor.', 'Tiempos de espera, cancelación y errores visibles.']) + '</div><div><h3>Gasto medible</h3>' + puntos(['Solicitar solo los campos necesarios.', 'Limitar búsquedas abusivas y recálculos.', 'Medir costo por búsqueda, viaje y país.', 'Combinar cuotas de consumo con alertas.']) + '</div></div><p class="criterio"><strong>Resultado esperado</strong> La app comunica fallos y los consumos quedan medidos y limitados.</p>')

fase(6)

slide('Navegación dentro de ViajaYa', '<div class="two-col"><div><h3>Google Navigation SDK</h3>' + puntos(['Guía giro a giro, voz, distancia, ETA y recálculo.', 'Conductor → recogida → destino.', 'Modo de vehículo validado para taxi, moto y encomiendas.', 'Controles grandes y pocas acciones durante la conducción.']) + '</div><div><h3>Integración con el viaje</h3>' + puntos(['Destinos y etapa desde el viaje activo.', 'Reanudar sin solicitar destinos por cada render o GPS.', 'Llegar no completa el servicio ni confirma el pago.', 'Mantener el seguimiento del pasajero.']) + '</div></div><p class="fuente">Primero certificar compatibilidad con Expo 56 / RN 0.85.3 y build firmado; el <a href="https://github.com/googlemaps/react-native-navigation-sdk" target="_blank" rel="noopener noreferrer">wrapper oficial es beta</a>. Validar <a href="https://developers.google.com/maps/documentation/navigation/android-sdk/coverage-nav-sdk" target="_blank" rel="noopener noreferrer">cobertura y modo de vehículo</a>.</p>')

slide('Google integrado y Waze opcional', '<div class="two-col"><div><h3>Opción principal: Google</h3>' + puntos(['La guía permanece dentro de ViajaYa.', 'Configurar Navigation SDK y credenciales nativas restringidas.', 'Recuperar fallos de GPS, permisos, red, cuota y falta de ruta.']) + '</div><div><h3>Alternativa externa: Waze</h3>' + puntos(['Abrir Waze con el destino de la etapa actual.', 'Si no está instalado, continuar con Google integrado.', 'Al volver, recuperar el viaje y mantener seguimiento.', 'No asumir que un deep link devuelve ETA o ruta.']) + '</div></div><p class="criterio"><strong>Una guía activa</strong> Evitar dos voces simultáneas. Waze no reemplaza la navegación integrada requerida.</p><p class="fuente">El SDK de Waze no permite incrustar su mapa y navegación: <a href="https://developers.google.com/waze/intro-transport" target="_blank" rel="noopener noreferrer">limitaciones oficiales</a> · <a href="https://developers.google.com/waze/deeplinks" target="_blank" rel="noopener noreferrer">deep links</a>.</p>')

fase(7)

detalle(7, 'QR y registro de pagos', [
    'Separar servicio completado de pago cobrado.',
    'QR por obligación: importe, moneda, referencia y vencimiento.',
    'Confirmación desde el proveedor; tolerar duplicados, retrasos y reintentos.',
    'Guardar tarifa y regla de comisión aplicadas al aceptar el viaje.',
    'Registro contable auditable de cobros, comisiones, ajustes y devoluciones.'
], 'Un evento repetido o una caída del servidor no duplica el cobro.')

slide('Efectivo, comisiones y liquidaciones', '<div class="two-col"><div><h3>Lo que debe el conductor</h3>' + puntos(['Registrar efectivo declarado y comisión adeudada, con opción de reclamo.', 'Compensar deuda contra liquidaciones QR.', 'Permitir pagar comisiones pendientes por QR.', 'Limitar nuevas operaciones por deuda; terminar las activas.']) + '</div><div><h3>Lo que debe conciliar ViajaYa</h3>' + puntos(['Comparación diaria con el proveedor.', 'Cola de diferencias para finanzas.', 'Liquidaciones y devoluciones trazables.', 'Reemplazar la billetera vacía por pagos y liquidaciones reales.']) + '</div></div><p class="criterio"><strong>Resultado esperado</strong> Explicar cada importe desde el viaje hasta su cobro, comisión y liquidación.</p>')

fase(8)

detalle(8, 'Retiro, entrega y excepciones', [
    'Remitente, destinatario, teléfonos, descripción y límites del paquete.',
    'Artículos restringidos y condiciones del servicio visibles.',
    'Registro de retiro, entrega y recepción mediante código.',
    'Destinatario ausente, entrega fallida, devoluciones e incidentes.',
    'Ajustes de cobro con causa y aprobación auditables.'
], 'La entrega se completa o se resuelve excepcionalmente desde la app y el panel.')

fase(9)

detalle(9, 'Infraestructura y despliegue', [
    'Desarrollo, pruebas y producción aislados: API, datos, secretos y proveedores propios.',
    'API permanente, PostgreSQL con disponibilidad y caché privada administrados.',
    'Imágenes reproducibles, HTTPS/WSS, migraciones únicas y compatibilidad de versiones.',
    'Rechazar configuración local/insegura y certificar realtime en dos réplicas.',
    'Dependencias fijadas, escaneo de secretos y controles obligatorios en PR.'
], 'Desplegar de forma repetible y validar latencia desde Bolivia antes de fijar región.', 'Render de pago es la propuesta inicial. <a href="https://render.com/docs/regions" target="_blank" rel="noopener noreferrer">Regiones disponibles</a>')

slide('Promoción de versiones entre entornos', '<p class="intro">Desarrollo → CI y PR → pruebas → certificación → producción</p><div class="two-col"><div><h3>Backend</h3>' + puntos(['Validar candidato, migraciones y rollback en pruebas.', 'Promover la misma imagen certificada con secretos propios.', 'Rechazar tokens y callbacks de otro entorno.', 'Bloquear simulaciones y pruebas destructivas en producción.']) + '</div><div><h3>Android</h3>' + puntos(['Mismo commit; variantes con identificadores y configuración distintos.', 'Instalar desarrollo, pruebas y producción juntas.', 'Separar actualizaciones y destino de API.', 'Certificar el AAB productivo antes de promoverlo al público.']) + '</div></div><p class="fuente">Una pista interna de Google Play no cambia el backend del binario. No copiar datos personales productivos a desarrollo o pruebas.</p>')

slide('Alertas y recuperación', '<div class="triple"><div><h3>Observar</h3>' + puntos(['Errores Android y backend.', 'Logs sanitizados y métricas.', 'Alertas con destinatario real.', 'Diagnóstico protegido.']) + '</div><div><h3>Recuperar datos</h3>' + puntos(['Backups y recuperación a un momento determinado.', 'Copia externa.', 'Restauración ensayada.']) + '</div><div><h3>Recuperar servicio</h3>' + puntos(['Rollback comprobado.', 'Responsable de incidentes.', 'Objetivo RPO ≤ 15 min.', 'Objetivo RTO ≤ 2 h.']) + '</div></div><p class="criterio"><strong>Resultado esperado</strong> Detectar un fallo, avisar a una persona y recuperar el servicio con evidencia.</p>')

slide('Privacidad y certificación real', '<div class="two-col"><div><h3>Cuentas y datos</h3>' + puntos(['Términos, privacidad y soporte publicados.', 'Consentimiento versionado iniciado en F02.', 'Eliminación desde app y web.', 'Anonimización y retención por categoría.']) + '</div><div><h3>Proveedores productivos</h3>' + puntos(['OTP real acotado y presupuestado, solo en producción.', 'OAuth con firmas y credenciales productivas.', 'QR y Navigation certificados en zonas objetivo.', 'Costos medidos y responsables identificados.']) + '</div></div><p class="criterio"><strong>Requisito para cerrar</strong> Completar integración, aislamiento, carga y recuperación; presupuesto cero no permite certificar ni abrir una operación productiva.</p><p class="fuente"><a href="https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN" target="_blank" rel="noopener noreferrer">Política de eliminación de cuentas de Google Play</a></p>')

slide('Certificar acceso y navegación', '<div class="two-col"><div><h3>Teléfono y cuentas sociales</h3>' + puntos(['OTP simulado con autofill; cero llamadas al proveedor en entornos bajos.', 'Desactivar autofill: errores, caducidad, reenvío y recuperación.', 'Google/Facebook con y sin teléfono verificado.', 'Migración, conflictos y altas simultáneas sin duplicar cuentas.']) + '</div><div><h3>Guía del conductor</h3>' + puntos(['Recogida y destino; voz, desvíos y cambio de etapa.', 'Permisos, GPS, bloqueo de pantalla y reinicio.', 'Waze instalado/ausente y retorno a ViajaYa.', 'Seguimiento del pasajero y solicitudes de navegación sin duplicación.']) + '</div></div><p class="criterio"><strong>Acceso protegido</strong> No emitir sesiones operativas antes del OTP requerido. La llegada del SDK no cierra el viaje ni el pago.</p>')

slide('Pruebas antes de publicar', '<div class="two-col"><div><h3>Servicio completo</h3>' + puntos(['Dos teléfonos: taxi, moto y encomienda; QR y efectivo.', 'Sesión inválida, cuenta suspendida y recuperación.', 'Red lenta, reconexión, cierre y segundo plano.', 'GPS antiguo, permisos y accesibilidad.']) + '</div><div><h3>Dinero y acceso</h3>' + puntos(['Pagos duplicados y tardíos, deuda y reclamos.', 'Devoluciones y liquidaciones fallidas.', 'Aislamiento por usuario, zona y permiso.', 'Instalación limpia, actualización y OAuth firmado.']) + '</div></div><p class="criterio"><strong>Base obligatoria</strong> CI verde, contratos, PostgreSQL/Redis, tipos, lint y pruebas mobile.</p>')

slide('Capacidad y condiciones de apertura', '<div class="stats"><div><strong>≤ 500 ms</strong><span>API propia · percentil 95</span></div><div><strong>≤ 2 s</strong><span>evento realtime visible · p95</span></div><div><strong>2×</strong><span>ráfagas sobre la carga objetivo</span></div></div><div class="two-col"><div>' + puntos(['Carga sostenida: 500 conductores y, como hipótesis, 500 pasajeros.', 'Sin asignaciones dobles, cobros duplicados ni cancelaciones falsas.']) + '</div><div>' + puntos(['Restauración y rollback ensayados; alerta recibida.', 'Conductores aprobados, soporte y conciliación por zona.', 'Aprobación de Google Play: cierre en F10.']) + '</div></div><p class="fuente">Objetivos de aceptación propuestos; deben medirse en el entorno desplegado.</p>')

fase(10)

slide('Google Play y binario certificado', '<div class="two-col"><div><h3>Preparar la revisión</h3>' + puntos(['AAB firmado, sin depender de Metro.', 'Data Safety, permisos, ficha y capturas.', 'Acceso para revisión de la tienda.', 'Comprobar requisitos de la cuenta Play.']) + '</div><div><h3>Certificar la distribución</h3>' + puntos(['Prueba interna/cerrada según corresponda.', 'Instalación limpia, actualización y accesibilidad.', 'Promover el mismo AAB productivo certificado.', 'La pista no cambia la API del binario.']) + '</div></div><p class="criterio"><strong>Cierre de publicación</strong> Binario aceptado, evidencia registrada y requisitos de la cuenta cumplidos. La prueba de 12 personas durante 14 días aplica a determinadas cuentas personales nuevas.</p><p class="fuente"><a href="https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB" target="_blank" rel="noopener noreferrer">Requisitos de pruebas de Google Play</a></p>')

slide('Abrir y ampliar por zonas', '<div class="triple"><div><h3>Antes de habilitar</h3>' + puntos(['Taxi, moto y encomiendas listos.', 'Conductores aprobados y soporte.', 'QR, efectivo y conciliación.', 'Alertas y límites de gasto.']) + '</div><div><h3>Durante la apertura</h3>' + puntos(['Activar zonas mediante flags.', 'Revisar errores y pagos.', 'Medir costo por servicio.', 'Conservar viajes activos al pausar.']) + '</div><div><h3>Para crecer</h3>' + puntos(['Ampliar según estabilidad.', 'Ajustar capacidad a demanda.', 'Confirmar margen observado.', 'Certificar cada país nuevo.']) + '</div></div><p class="criterio"><strong>Apertura gradual</strong> La gradualidad es geográfica; no elimina los tres servicios acordados para el lanzamiento.</p>')

fase_actual = None

slide('Contratos entre backend y app', '<div class="table-wrap"><table><thead><tr><th>Área</th><th>Contrato nuevo o ampliado</th></tr></thead><tbody>' + ''.join(f'<tr><td>{a}</td><td>{b}</td></tr>' for a,b in [('Autenticación','OTP, alta por teléfono, identidades sociales y sesiones'),('Configuración','Países, zonas, moneda, países SMS y opciones de navegación'),('Conductores','Documentos, aprobación y elegibilidad'),('Viajes y realtime','Ubicación, etapa/destino, ETA, incidentes y encomiendas'),('Dinero','Pagos, comisiones, deuda, devoluciones y liquidaciones'),('Administración','Permisos, acciones protegidas y auditoría')]) + '</tbody></table></div><p class="criterio"><strong>Compatibilidad</strong> API v1, DTO en snake_case, migraciones revisadas y pruebas conjuntas con versiones instaladas.</p>')

slide('Presupuesto de infraestructura', '<p class="intro">Reservas mensuales orientativas en USD. Precios consultados el 09/09/2026.</p><div class="two-col budget"><div><p>Apertura acotada</p><strong>300–400</strong><span>USD / mes</span></div><div><p>Validación de capacidad objetivo</p><strong>700–1.000</strong><span>USD / mes</span></div></div><p class="intro small">Incluye producción y un entorno de pruebas alojado, backups y monitoreo. Desarrollo comienza local; no añade otro despliegue permanente en nube.</p><p class="criterio"><strong>Por presupuestar aparte</strong> Mapas, mensajes, pasarela, impuestos, desarrollo, soporte y seguros.</p><p class="fuente">Estimaciones propias, no garantía de capacidad. <a href="https://render.com/pricing" target="_blank" rel="noopener noreferrer">Precios oficiales de Render</a></p>')

slide('Costo base de mapas, sin guía', '<p class="intro">Ejemplo a 5.000 viajes diarios durante 30 días. Aún no incluye Navigation SDK.</p><div class="stats"><div><strong>1.250</strong><span>USD/mes · dos rutas por viaje</span></div><div><strong>3.488</strong><span>USD/mes · rutas + lugares</span></div><div><strong>4.200–4.500</strong><span>USD/mes · infraestructura + mapas, sin guía</span></div></div><p class="criterio"><strong>Hipótesis de lugares</strong> Un detalle Essentials y cinco solicitudes de autocompletado por viaje, además de las dos rutas.</p><p class="fuente">Excluye navegación, geocodificación, búsquedas abandonadas, recálculos, mensajes, pasarela, impuestos y operación humana. <a href="https://developers.google.com/maps/billing-and-pricing/pricing" target="_blank" rel="noopener noreferrer">Tarifas de Google Maps</a>.</p>')

slide('Presupuesto con navegación integrada', '<p class="intro">Escenario de 150.000 viajes al mes, a tarifa pública y antes de optimizar consultas.</p><div class="stats"><div><strong>3.475</strong><span>USD/mes · un destino de navegación por viaje</span></div><div><strong>6.475</strong><span>USD/mes · dos destinos: recogida y entrega</span></div><div><strong>10.700–11.000</strong><span>USD/mes · infraestructura, mapas y dos destinos</span></div></div><p class="criterio"><strong>Supuesto conservador</strong> Mantiene las consultas de mapas anteriores. Medir y evitar duplicados entre Routes y Navigation SDK.</p><p class="fuente">No es el costo de empezar. Excluye SMS, pasarela, impuestos y operación. Los desvíos automáticos no generan un cargo adicional por sí mismos. <a href="https://developers.google.com/maps/documentation/navigation/android-sdk/pricing" target="_blank" rel="noopener noreferrer">Facturación</a> · <a href="https://developers.google.com/maps/billing-and-pricing/pricing" target="_blank" rel="noopener noreferrer">Tarifas</a>.</p>')

slide('Control del gasto por entorno', '<div class="two-col"><div><h3>Medición y límites</h3>' + puntos(['Costo por entorno, búsqueda, navegación, viaje, OTP y país.', 'Alertas al 50 %, 80 % y 100 % del presupuesto.', 'Cuotas y protección contra abuso; entrega y reintentos SMS.', 'Margen: comisión menos pasarela, tecnología, ajustes y devoluciones.']) + '</div><div><h3>Otros cargos variables</h3>' + puntos(['Producción: Verify USD 0,05 por verificación más el canal; cotizar Bolivia.', 'Desarrollo/pruebas: OTP simulado y autocompletado, sin SMS ni cargos.', 'EAS: gratuito o Starter USD 19/mes más consumo.', 'QR y liquidaciones según contrato.']) + '</div></div><p class="fuente">Una alerta no detiene cargos. Fuentes: <a href="https://developers.google.com/maps/billing-and-pricing/manage-costs" target="_blank" rel="noopener noreferrer">Maps</a> · <a href="https://www.twilio.com/en-us/verify/pricing" target="_blank" rel="noopener noreferrer">Verify</a> · <a href="https://expo.dev/pricing" target="_blank" rel="noopener noreferrer">Expo</a></p>')

slide('Cómo cerrar cada fase', '<div class="triple"><div><h3>Implementar</h3>' + puntos(['Tomar el primer PR pendiente.', 'Revisar la base existente.', 'Actualizar ambos contratos.', 'Registrar responsable y bloqueos.']) + '</div><div><h3>Comprobar</h3>' + puntos(['Pruebas proporcionales al cambio.', 'Demostración del recorrido.', 'Migraciones revisadas.', 'Evidencia y costo observado.']) + '</div><div><h3>Avanzar</h3>' + puntos(['Evaluar el criterio de cierre.', 'Registrar PR y resultados.', 'Completar dependencias.', 'Certificar todo junto en F09.']) + '</div></div><p class="criterio"><strong>Estados</strong> Pendiente → En curso → Completada. Registrar Bloqueada cuando falte una condición externa; continuar con trabajo independiente.</p>')

slide('F01 verificada · Siguiente: F02', '<p class="intro">La base de entornos está implementada y comprobada localmente.</p><div class="two-col"><div><h3>Evidencia</h3>' + puntos(['649 pruebas backend; 69 opt-in PostgreSQL/Redis omitidas.', '235 pruebas mobile; tipos, lint y contratos.', 'Tres proyectos Android y bundle Hermes.', 'Smoke Docker con PostgreSQL desechable.']) + '</div><div><h3>Qué sigue</h3>' + puntos(['F02-A: identidad y desafío OTP simulado.', 'F02-B: flujo móvil, autofill y recuperación.', 'F02-C: Google/Facebook y migración de cuentas.', 'Mantener cero llamadas OTP en entornos bajos.']) + '</div></div><p class="criterio"><strong>Pendiente externo</strong> Nube, proveedores reales y certificación de APK/AAB firmados. La generación de proyectos y el bundle no sustituyen las pruebas en teléfonos.</p>')

css = r'''
:root{--bg:#002615;--panel:#284638;--accent:#BCEF59;--ink:#fff;--muted:#c3d1c8;--line:#42604e;font-family:Inter,"Helvetica Neue","Segoe UI",Arial,sans-serif;color:var(--ink);background:#071c12;color-scheme:dark}
*{box-sizing:border-box}body{margin:0}button,a,select{-webkit-tap-highlight-color:transparent}button,select{font:inherit}button{cursor:pointer}a{color:var(--accent);text-underline-offset:4px}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid var(--accent);outline-offset:5px}[hidden]{display:none!important}
.toolbar{min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 28px;border-bottom:1px solid var(--line);background:#071c12}.brand{font-size:19px;font-weight:700;white-space:nowrap}.brand span{color:var(--accent)}.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.toolbar button,.nav button{padding:9px 13px;min-height:40px;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:5px}.toolbar button:hover,.nav button:hover{background:var(--panel)}.toolbar button[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
.stage{max-width:1400px;margin:0 auto;padding:24px 30px 20px}.slide{width:100%;aspect-ratio:16/9;background:var(--bg);border:1px solid #244832;container-type:inline-size;box-shadow:0 16px 60px #0003}.slide-inner{position:relative;display:flex;flex-direction:column;min-height:100%;padding:3.6cqw 4.2cqw 2.8cqw}.slide header{margin-bottom:2.5cqw}.eyebrow{font-size:1cqw;letter-spacing:.15em;font-weight:600;color:var(--muted);margin:0 0 1cqw}h2{font-size:3.45cqw;font-weight:500;line-height:1.15;letter-spacing:-.035em;margin:0;color:var(--accent)}h2:focus{outline:0}.slide-body{flex:1}.slide p{line-height:1.48}.slide footer{display:flex;justify-content:space-between;gap:12px;margin-top:2.3cqw;font-size:.95cqw;color:var(--muted)}.intro{font-size:1.8cqw;max-width:90%;margin:0 0 2.4cqw}.intro.small{font-size:1.6cqw;max-width:95%}
.cover .slide-inner{justify-content:center;text-align:center;min-height:56.25cqw}.cover header{margin-bottom:2.8cqw}.cover .eyebrow{display:inline-block;background:var(--panel);border-radius:40px;padding:.65cqw 2cqw;margin-bottom:4cqw;font-size:1.15cqw;letter-spacing:.03em}.cover h2{font-size:6.15cqw;line-height:1.06;font-weight:400}.cover .slide-body{flex:0}.lead{font-size:2.1cqw;line-height:1.5;margin:0 auto 2cqw}.cover-meta{font-size:1.4cqw;margin:0;color:var(--accent)}.cover-date{font-size:1.05cqw;color:var(--muted);margin:1.2cqw 0 0}.cover footer{display:none}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:5cqw}.triple{display:grid;grid-template-columns:repeat(3,1fr);gap:3.5cqw}.two-col h3,.triple h3{font-size:1.8cqw;font-weight:600;color:var(--accent);margin:0 0 1.3cqw}.triple p{font-size:1.55cqw;margin:0}.puntos{list-style:none;padding:0;margin:0}.puntos li{position:relative;padding-left:1.6cqw;font-size:1.6cqw;line-height:1.42;margin:0 0 1.2cqw}.puntos li:before{content:'•';position:absolute;left:0;color:var(--accent)}.puntos li:last-child{margin-bottom:0}.criterio{border-top:1px solid var(--line);margin:2.6cqw 0 0;padding-top:1.3cqw;font-size:1.35cqw;line-height:1.5}.criterio strong{color:var(--accent);margin-right:.5em}.fuente{font-size:1.02cqw;color:var(--muted);margin:1.6cqw 0 0;line-height:1.5}
.frente{display:grid;grid-template-columns:18% 1fr;gap:3.2cqw;align-items:start}.numero-frente{font-size:8cqw;line-height:.95;font-weight:400;color:var(--accent)}.numero-frente span{display:block;font-size:.8cqw;letter-spacing:.1em;color:var(--muted);line-height:1.5;margin-top:1.6cqw}.frente .puntos li{font-size:1.67cqw;margin-bottom:1.35cqw}.stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3cqw;margin:3cqw 0 3.2cqw}.stats>div{border-top:1px solid var(--line);padding-top:1.5cqw}.stats strong{display:block;font-weight:400;font-size:4.1cqw;color:var(--accent);letter-spacing:-.05em;white-space:nowrap}.stats span{font-size:1.3cqw;line-height:1.5;display:block;margin-top:.5cqw}.agenda{display:grid;grid-template-columns:1fr 1fr;gap:0 5cqw}.agenda>div{display:flex;align-items:center;gap:1.7cqw;border-bottom:1px solid var(--line);padding:1.2cqw 0}.agenda span{font-size:1.55cqw;color:var(--accent)}.agenda p{font-size:1.7cqw;margin:0}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;font-size:1.45cqw}th,td{padding:1.1cqw 1cqw;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--accent);font-weight:600}td:first-child{width:25%;font-weight:500}.budget{margin:3cqw 0}.budget>div{border-top:1px solid var(--line);padding:1.4cqw 0}.budget p{font-size:1.65cqw;margin:0 0 .8cqw}.budget strong{display:block;font-size:5.1cqw;color:var(--accent);font-weight:400;letter-spacing:-.04em}.budget span{font-size:1.2cqw;color:var(--muted)}.timeline{display:grid;grid-template-columns:repeat(3,1fr);gap:3.5cqw;margin:3cqw 0}.timeline>div{border-top:2px solid var(--accent);padding-top:1.7cqw}.timeline span{font-size:3.8cqw;color:var(--accent)}.timeline h3{font-size:1.9cqw;font-weight:500}.timeline p{font-size:1.65cqw}
.nav{max-width:1340px;margin:0 auto;padding:0 0 24px;display:flex;align-items:center;gap:16px;justify-content:center}.nav button:disabled{opacity:.35;cursor:default}.nav select{max-width:420px;width:40%;padding:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:5px}.nav output{font-size:13px;color:var(--muted);min-width:48px}.hint{font-size:12px;color:var(--muted);text-align:center;margin:0 0 16px}.progress{height:3px;background:#254131;position:fixed;bottom:0;left:0;right:0}.progress div{height:100%;background:var(--accent);transition:width .18s}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
body.overview .stage{display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:1800px}body.overview .slide{cursor:pointer}body.overview .slide:hover{outline:2px solid var(--accent)}body.overview .nav,body.overview .hint,body.reading .nav,body.reading .hint{display:none}body.reading .stage{display:none}.document{max-width:1000px;margin:36px auto 70px;padding:40px 55px;background:var(--bg);font-size:17px;line-height:1.75}.document h1{font-size:38px;color:var(--accent);line-height:1.2}.document h2{font-size:27px;margin-top:45px}.document h3{font-size:21px;color:var(--accent);margin-top:34px}.document table{font-size:15px}.document td,.document th{padding:12px}.document code{background:var(--panel);padding:2px 5px;border-radius:3px}.document li{margin-bottom:9px}.document p{margin:20px 0}
@media(min-width:1500px) and (min-height:900px){.stage{padding-top:36px}}@media(max-width:720px){.toolbar{padding:12px;align-items:flex-start;flex-direction:column;gap:10px}.tools{gap:6px;width:100%}.tools button{font-size:12px;padding:8px}.stage{padding:12px}.slide{aspect-ratio:auto;container-type:normal}.slide-inner{padding:26px 22px;min-height:60vh}.eyebrow{font-size:10px;margin-bottom:12px}.slide header{margin-bottom:24px}h2{font-size:29px}.cover .slide-inner{min-height:65vh}.cover .eyebrow{font-size:11px;padding:8px 16px;margin-bottom:40px}.cover h2{font-size:44px}.lead{font-size:19px;margin:24px auto}.cover-meta{font-size:14px}.cover-date{font-size:12px;margin-top:16px}.slide footer{font-size:10px;margin-top:26px}.intro,.intro.small{font-size:17px;max-width:100%;margin-bottom:22px}.two-col,.triple,.timeline{grid-template-columns:1fr;gap:25px}.two-col h3,.triple h3,.timeline h3{font-size:20px;margin-bottom:15px}.puntos li,.frente .puntos li{font-size:16px;padding-left:18px;margin-bottom:14px}.triple p,.timeline p{font-size:16px}.frente{grid-template-columns:1fr;gap:20px}.numero-frente{font-size:55px;display:flex;align-items:center;gap:18px}.numero-frente span{font-size:10px;margin:0}.criterio{font-size:14px;margin-top:25px;padding-top:16px}.fuente{font-size:12px;margin-top:18px}.stats{grid-template-columns:1fr;gap:22px;margin:24px 0}.stats>div{padding-top:15px}.stats strong{font-size:42px}.stats span{font-size:15px;margin-top:4px}.agenda{grid-template-columns:1fr;gap:0}.agenda>div{gap:18px;padding:13px 0}.agenda span{font-size:16px}.agenda p{font-size:17px}table{font-size:14px}th,td{padding:12px 8px}.budget{margin:24px 0}.budget>div{padding-top:14px}.budget p{font-size:16px}.budget strong{font-size:44px}.budget span{font-size:14px}.timeline{margin:25px 0}.timeline>div{padding-top:20px}.timeline span{font-size:40px}.nav{padding:0 12px 20px;gap:8px}.nav select{width:auto;flex:1;min-width:0;font-size:12px}.nav button{padding:8px;font-size:13px}.nav output{display:none}.hint{font-size:11px}body.overview .stage{grid-template-columns:1fr}.document{margin:16px 12px;padding:24px 20px;font-size:16px}.document h1{font-size:31px}.document h2{font-size:25px}.document table{font-size:13px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}@media print{@page{size:A4 landscape;margin:8mm}:root{color-scheme:light}.toolbar,.nav,.hint,.progress,.sr-only{display:none!important}body{background:white!important}.stage,body.overview .stage{display:block!important;max-width:none;padding:0;margin:0}.slide,.slide[hidden]{display:block!important;aspect-ratio:auto;width:100%;min-height:185mm;break-after:page;page-break-after:always;border:0;box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact;container-type:inline-size}.slide:last-child{break-after:auto;page-break-after:auto}.slide-inner{min-height:185mm}.cover .slide-inner{min-height:185mm}body.reading .stage{display:none!important}.document{margin:0;padding:10mm;max-width:none;background:white;color:black;line-height:1.5}.document h1,.document h2,.document h3,.document a{color:#164228}.document table{font-size:12px}.document tr{break-inside:avoid}.document code{background:#edf2ef}.document h2,.document h3{break-after:avoid}}
'''

js = r'''
const slides = [...document.querySelectorAll('.slide')];
const picker = document.querySelector('#selector');
const progress = document.querySelector('#progress-fill');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const overview = document.querySelector('#overview');
const reading = document.querySelector('#reading');
const documentView = document.querySelector('#document');
let current = 0;
let mode = 'slides';
slides.forEach((s,i) => { const option=document.createElement('option'); option.value=i; option.textContent=String(i+1).padStart(2,'0')+' · '+s.dataset.title.replace(/<br>/g,' '); picker.append(option); });
function show(index, focus=false){
  current = Math.max(0, Math.min(slides.length-1, index));
  slides.forEach((s,i) => {s.hidden=mode==='slides' && i!==current; if(mode==='overview'){s.setAttribute('tabindex','0');s.setAttribute('role','button');s.setAttribute('aria-label','Abrir diapositiva '+(i+1)+': '+s.dataset.title.replace(/<br>/g,' '));}else{s.removeAttribute('tabindex');s.removeAttribute('role');s.removeAttribute('aria-label');}});
  document.body.classList.toggle('overview',mode==='overview');
  document.body.classList.toggle('reading',mode==='document');
  documentView.hidden=mode!=='document';
  document.querySelector('#stage').hidden=mode==='document';
  previous.disabled=current===0;next.disabled=current===slides.length-1;
  picker.value=String(current);document.querySelector('#counter').textContent=(current+1)+' / '+slides.length;
  progress.style.width=((current+1)/slides.length*100)+'%';
  overview.setAttribute('aria-pressed',String(mode==='overview'));reading.setAttribute('aria-pressed',String(mode==='document'));
  overview.textContent=mode==='overview'?'Volver a diapositivas':'Ver todas';reading.textContent=mode==='document'?'Volver a diapositivas':'Plan completo';
  document.querySelector('#announcer').textContent=mode==='document'?'Plan completo':mode==='overview'?'Vista de todas las diapositivas':'Diapositiva '+(current+1)+' de '+slides.length+': '+slides[current].dataset.title.replace(/<br>/g,' ');
  const hash=mode==='document'?'#plan-completo':mode==='overview'?'#todas':'#diapositiva-'+(current+1);
  try{history.replaceState(null,'',hash);}catch(e){}
  if(focus && mode==='slides')slides[current].querySelector('h2').focus({preventScroll:true});
}
function navigate(index){mode='slides';show(index,true);window.scrollTo({top:0});}
previous.addEventListener('click',()=>navigate(current-1));next.addEventListener('click',()=>navigate(current+1));
picker.addEventListener('change',()=>navigate(Number(picker.value)));
overview.addEventListener('click',()=>{mode=mode==='overview'?'slides':'overview';show(current);window.scrollTo({top:0});});
reading.addEventListener('click',()=>{mode=mode==='document'?'slides':'document';show(current);window.scrollTo({top:0});});
slides.forEach((s,i)=>{s.addEventListener('click',e=>{if(mode==='overview'&&!e.target.closest('a'))navigate(i);});s.addEventListener('keydown',e=>{if(mode==='overview'&&e.target===s&&(e.key==='Enter'||e.key===' ')){e.preventDefault();navigate(i);}});});
document.addEventListener('keydown',e=>{
  if(e.target.closest('button,a,input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey)return;
  if(e.key==='Escape' && mode!=='slides'){mode='slides';show(current,true);return;}
  if(mode!=='slides')return;
  if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();navigate(current+1);}
  if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();navigate(current-1);}
  if(e.key==='Home'){e.preventDefault();navigate(0);}
  if(e.key==='End'){e.preventDefault();navigate(slides.length-1);}
});
document.querySelector('#print').addEventListener('click',()=>window.print());
document.querySelector('#download').addEventListener('click',()=>{
  const text=JSON.parse(document.querySelector('#plan-source').textContent);
  const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='plan-salida-produccion.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
const fsButton=document.querySelector('#fullscreen');
if(!document.documentElement.requestFullscreen){fsButton.hidden=true;}
fsButton.addEventListener('click',async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch(e){document.querySelector('#announcer').textContent='Puedes ampliar la ventana del navegador para presentar.';}});
window.addEventListener('hashchange',readHash);
function readHash(){const hash=location.hash; mode=hash==='#plan-completo'?'document':hash==='#todas'?'overview':'slides';const match=hash.match(/^#diapositiva-(\d+)$/);show(match?Number(match[1])-1:current);}
readHash();
'''

pagina = '''<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="description" content="Plan local de producción de ViajaYa: 10 fases de implementación, dependencias, presupuesto y criterios de cierre."><title>ViajaYa — Plan de producción</title><style>''' + css + '''</style></head>
<body><div class="toolbar"><div class="brand">Viaja<span>Ya</span> <span aria-hidden="true">/</span> Producción</div><nav class="tools" aria-label="Vistas y archivos"><button id="overview" aria-pressed="false">Ver todas</button><button id="reading" aria-pressed="false">Plan completo</button><button id="download">Descargar plan .md</button><button id="print">Imprimir / PDF</button><button id="fullscreen">Pantalla completa</button></nav></div>
<main id="stage" class="stage" aria-label="Presentación del plan">''' + '\n'.join(diapositivas) + '''</main>
<article id="document" class="document" aria-label="Plan de implementación completo" hidden>''' + markdown(plan) + '''</article>
<nav class="nav" aria-label="Navegación de diapositivas"><button id="previous" aria-label="Diapositiva anterior">← Anterior</button><label class="sr-only" for="selector">Ir a una diapositiva</label><select id="selector"></select><output id="counter"></output><button id="next" aria-label="Diapositiva siguiente">Siguiente →</button></nav><p class="hint">Flechas para navegar · Inicio / Fin · Esc para volver · Archivo autónomo, disponible sin conexión</p><div class="progress" aria-hidden="true"><div id="progress-fill"></div></div><p class="sr-only" role="status" aria-live="polite" id="announcer"></p><noscript><style>.slide[hidden]{display:block!important}.toolbar,.nav,.hint,.progress{display:none}.slide{margin-bottom:25px}</style><p>Activa JavaScript para navegar. Las diapositivas se muestran completas a continuación.</p></noscript>
<script id="plan-source" type="application/json">''' + json.dumps(plan, ensure_ascii=False).replace('<','\\u003c') + '''</script><script>''' + js + '''</script></body></html>'''

(BASE / 'presentacion-salida-produccion.html').write_text(pagina, encoding='utf-8')
print(json.dumps({'diapositivas': len(diapositivas), 'archivo': str(BASE / 'presentacion-salida-produccion.html'), 'bytes': len(pagina.encode('utf-8'))}, ensure_ascii=False))
