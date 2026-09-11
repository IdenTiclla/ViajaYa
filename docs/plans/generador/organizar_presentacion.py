"""Reordena la presentación existente usando la misma matriz de fases del plan."""
from pathlib import Path
import ast
import re

BASE = Path(__file__).resolve().parents[1]
ruta = BASE / '.build' / 'generar_presentacion.py'
original = ruta.read_text(encoding='utf-8')
assert 'Diez frentes pendientes' in original, 'La presentación ya fue reorganizada.'
llamadas = {}
for nodo in ast.parse(original).body:
    if isinstance(nodo, ast.Expr) and isinstance(nodo.value, ast.Call) and isinstance(nodo.value.func, ast.Name) and nodo.value.func.id in ('slide', 'frente'):
        llamada = nodo.value
        titulo = ast.literal_eval(llamada.args[0 if llamada.func.id == 'slide' else 1])
        llamadas[titulo] = ast.get_source_segment(original, nodo)
assert len(llamadas) == 32

def previa(titulo):
    texto = llamadas[titulo]
    texto = re.sub(r", etiqueta='PENDIENTES · CONTINUACIÓN DEL FRENTE \d+'", '', texto)
    return texto.replace('frente(', 'detalle(')

inicio = original[:original.index('def frente(')]
inicio = inicio.replace("plan = (BASE / 'plan-salida-produccion.md').read_text(encoding='utf-8')", "plan = (BASE / 'plan-salida-produccion.md').read_text(encoding='utf-8')\nfases = json.loads((BASE / '.build' / 'fases.json').read_text(encoding='utf-8'))\nfase_actual = None\nfor fase_plan in fases:\n    assert f\"### Fase {fase_plan['numero']:02d}. {fase_plan['titulo']}\" in plan")
inicio = inicio.replace("    numero = len(diapositivas) + 1\n", "    numero = len(diapositivas) + 1\n    if fase_actual is not None:\n        etiqueta = f\"FASE {fase_actual['numero']:02d} · PENDIENTE\"\n    titulo_selector = (f\"F{fase_actual['numero']:02d} · \" if fase_actual else '') + titulo\n")
inicio = inicio.replace('html.escape(titulo, quote=True)', 'html.escape(titulo_selector, quote=True)')
inicio = inicio.replace("salida.append('<li>' + en_linea(linea[2:]) + '</li>')", "salida.append('<li>' + ('<span aria-label=\"Pendiente\">☐</span> ' + en_linea(linea[6:]) if linea.startswith('- [ ] ') else en_linea(linea[2:])) + '</li>')")

funciones = '''def detalle(num, titulo, items, cierre, nota=''):
    num = fase_actual['numero']
    slide(titulo, '<div class="frente"><div class="numero-frente">' + f'{num:02d}' + '<span>DETALLE DE LA FASE</span></div><div>' + puntos(items) + '</div></div><p class="criterio"><strong>Resultado esperado</strong> ' + en_linea(cierre) + '</p>' + (f'<p class="fuente">{nota}</p>' if nota else ''))


def fase(numero):
    global fase_actual
    fase_actual = fases[numero - 1]
    f = fase_actual
    slide(f['titulo'], '<p class="intro small">' + en_linea(f['objetivo']) + '</p><div class="frente"><div class="numero-frente">' + f'{numero:02d}' + '<span>FASE · PENDIENTE</span></div><div>' + puntos(f['prs']) + '</div></div><p class="criterio"><strong>Cierre</strong> ' + en_linea(f['cierre']) + '</p><p class="fuente"><strong>Depende de:</strong> ' + en_linea(f['depende']) + '</p>')


'''

contenido = [
    previa('ViajaYa<br>Salida a producción').replace('Revisión 4 · OTP sin SMS en desarrollo y pruebas', 'Revisión 5 · Diez fases para implementar'),
    previa('Alcance del lanzamiento'),
    previa('Lo que ya existe y lo que falta'),
    """slide('Diez fases para implementar', '<div class="agenda">' + ''.join(f'<div><span>{f["numero"]:02d}</span><p>{f["titulo"]}</p></div>' for f in fases) + '</div><p class="fuente">Todas pendientes · 30 entregas sugeridas para PR · Cada fase tiene dependencias, comprobaciones y criterio de cierre.</p>')""",
    """slide('Orden y trabajo en paralelo', '<div class="timeline"><div><span>01–04</span><h3>Base y operación</h3><p>Entornos → acceso → países y panel → conductores.</p></div><div><span>05–08</span><h3>Servicio completo</h3><p>Seguimiento → navegación. Pagos puede avanzar en paralelo; ambos deben estar listos para cerrar encomiendas.</p></div><div><span>09–10</span><h3>Certificar y abrir</h3><p>Infraestructura, proveedores y cumplimiento → Google Play y apertura por zonas.</p></div></div><p class="criterio"><strong>Con una persona</strong> Seguir F01–F10. Adelantar la prueba de compatibilidad de Navigation y preparar proveedores desde el inicio.</p>')""",
    """slide('Proveedores y operación en paralelo', '<div class="two-col"><div><h3>Empezar junto con F01</h3>' + puntos(['Definir zonas, servicios y responsables.', 'Revisar condiciones locales, seguros y contratos.', 'Preparar cuentas, dominio y Google Play.', 'Cotizar hosting, OTP, Google y pasarela QR.']) + '</div><div><h3>Cuándo se necesitan</h3>' + puntos(['F06: cuenta y presupuesto limitado para Navigation real.', 'F07: condiciones y sandbox de la pasarela.', 'F09: presupuesto, contratos y proveedores reales certificados.', 'F10: conductores, soporte y conciliación por zona.']) + '</div></div><p class="criterio"><strong>Primer paso viable</strong> F01 comienza localmente sin contratar nube ni SMS. Las gestiones externas no bloquean el trabajo independiente.</p>')""",
    'fase(1)',
    previa('Tres entornos separados'),
    """slide('Qué se entrega ahora y qué requiere nube', '<div class="two-col"><div><h3>F01 · Preparación verificable</h3>' + puntos(['Desarrollo reproducible en Windows.', 'Contrato de entorno, variantes y API separadas.', 'CI y definiciones de despliegue.', 'OTP simulado solo en entornos bajos; flujo en F02.']) + '</div><div><h3>Antes de cerrar F09</h3>' + puntos(['Pruebas y producción realmente alojados.', 'Datos, cuentas, secretos y proveedores aislados.', 'Promoción y recuperación ensayadas.', 'Gasto contratado y proveedores certificados.']) + '</div></div><p class="criterio"><strong>Estado honesto</strong> Tener perfiles y configuración preparados no equivale a tener tres entornos operativos. Aprovisionar pruebas antes de los ensayos que lo requieran.</p>')""",
    'fase(2)',
    previa('Un solo flujo para entrar o registrarse'),
    previa('OTP sin costo en entornos bajos'),
    'fase(3)',
    previa('Bolivia y expansión internacional'),
    """slide('Panel base y activación por zona', '<div class="two-col"><div><h3>Entregar en F03</h3>' + puntos(['Acceso reforzado, roles y auditoría.', 'País, zona, servicio y disponibilidad.', 'Flags evaluadas por el backend.', 'La app recibe las capacidades habilitadas.']) + '</div><div><h3>Completar con cada función</h3>' + puntos(['F04: conductores, viajes e incidentes.', 'F07: cobros, deuda y liquidaciones.', 'F05–F09: indicadores de operación y gasto.', 'Flags para acceso social, SMS y navegación.']) + '</div></div><p class="criterio"><strong>Continuidad</strong> Apagar una función bloquea operaciones nuevas y deja terminar viajes y pagos activos. Las flags comerciales no sustituyen el despliegue técnico de Redis/outbox.</p>')""",
    'fase(4)',
    previa('Conductores y seguridad del servicio'),
    'fase(5)',
    previa('Seguimiento GPS y notificaciones'),
    previa('Mapas y control del consumo'),
    'fase(6)',
    previa('Navegación dentro de ViajaYa'),
    previa('Google integrado y Waze opcional'),
    'fase(7)',
    previa('QR y registro de pagos'),
    previa('Efectivo, comisiones y liquidaciones'),
    'fase(8)',
    previa('Encomiendas completas'),
    'fase(9)',
    previa('Infraestructura y despliegue'),
    previa('Promoción de versiones entre entornos'),
    previa('Alertas y recuperación'),
    """slide('Privacidad y certificación real', '<div class="two-col"><div><h3>Cuentas y datos</h3>' + puntos(['Términos, privacidad y soporte publicados.', 'Consentimiento versionado iniciado en F02.', 'Eliminación desde app y web.', 'Anonimización y retención por categoría.']) + '</div><div><h3>Proveedores productivos</h3>' + puntos(['OTP real acotado y presupuestado, solo en producción.', 'OAuth con firmas y credenciales productivas.', 'QR y Navigation certificados en zonas objetivo.', 'Costos medidos y responsables identificados.']) + '</div></div><p class="criterio"><strong>Requisito para cerrar</strong> Completar integración, aislamiento, carga y recuperación; presupuesto cero no permite certificar ni abrir una operación productiva.</p><p class="fuente"><a href="https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN" target="_blank" rel="noopener noreferrer">Política de eliminación de cuentas de Google Play</a></p>')""",
    previa('Certificar acceso y navegación'),
    previa('Pruebas antes de publicar'),
    previa('Capacidad y condiciones de apertura').replace('Binario aceptado por Google Play.', 'Aprobación de Google Play: cierre en F10.'),
    'fase(10)',
    """slide('Google Play y binario certificado', '<div class="two-col"><div><h3>Preparar la revisión</h3>' + puntos(['AAB firmado, sin depender de Metro.', 'Data Safety, permisos, ficha y capturas.', 'Acceso para revisión de la tienda.', 'Comprobar requisitos de la cuenta Play.']) + '</div><div><h3>Certificar la distribución</h3>' + puntos(['Prueba interna/cerrada según corresponda.', 'Instalación limpia, actualización y accesibilidad.', 'Promover el mismo AAB productivo certificado.', 'La pista no cambia la API del binario.']) + '</div></div><p class="criterio"><strong>Cierre de publicación</strong> Binario aceptado, evidencia registrada y requisitos de la cuenta cumplidos. La prueba de 12 personas durante 14 días aplica a determinadas cuentas personales nuevas.</p><p class="fuente"><a href="https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB" target="_blank" rel="noopener noreferrer">Requisitos de pruebas de Google Play</a></p>')""",
    """slide('Abrir y ampliar por zonas', '<div class="triple"><div><h3>Antes de habilitar</h3>' + puntos(['Taxi, moto y encomiendas listos.', 'Conductores aprobados y soporte.', 'QR, efectivo y conciliación.', 'Alertas y límites de gasto.']) + '</div><div><h3>Durante la apertura</h3>' + puntos(['Activar zonas mediante flags.', 'Revisar errores y pagos.', 'Medir costo por servicio.', 'Conservar viajes activos al pausar.']) + '</div><div><h3>Para crecer</h3>' + puntos(['Ampliar según estabilidad.', 'Ajustar capacidad a demanda.', 'Confirmar margen observado.', 'Certificar cada país nuevo.']) + '</div></div><p class="criterio"><strong>Apertura gradual</strong> La gradualidad es geográfica; no elimina los tres servicios acordados para el lanzamiento.</p>')""",
    'fase_actual = None',
    previa('Contratos entre backend y app'),
    previa('Presupuesto de infraestructura'),
    previa('Costo base de mapas, sin guía'),
    previa('Presupuesto con navegación integrada'),
    previa('Control del gasto por entorno'),
    """slide('Cómo cerrar cada fase', '<div class="triple"><div><h3>Implementar</h3>' + puntos(['Tomar el primer PR pendiente.', 'Revisar la base existente.', 'Actualizar ambos contratos.', 'Registrar responsable y bloqueos.']) + '</div><div><h3>Comprobar</h3>' + puntos(['Pruebas proporcionales al cambio.', 'Demostración del recorrido.', 'Migraciones revisadas.', 'Evidencia y costo observado.']) + '</div><div><h3>Avanzar</h3>' + puntos(['Evaluar el criterio de cierre.', 'Registrar PR y resultados.', 'Completar dependencias.', 'Certificar todo junto en F09.']) + '</div></div><p class="criterio"><strong>Estados</strong> Pendiente → En curso → Completada. Registrar Bloqueada cuando falte una condición externa; continuar con trabajo independiente.</p>')""",
    """slide('Empezar por F01-A', '<p class="intro">Primer PR sugerido: contrato y validación de entornos.</p><div class="two-col"><div><h3>Qué hacer</h3>' + puntos(['Inventariar backend, mobile, Docker y EAS.', 'Definir entornos, URLs e identidades.', 'Documentar modos OTP permitidos.', 'Actualizar configuración y ejemplos sin secretos.']) + '</div><div><h3>Qué demostrar</h3>' + puntos(['Configuraciones válidas aceptadas.', 'Cruces y modos inseguros rechazados.', 'Evidencia de comprobaciones adjunta.', 'Continuar con F01-B: variantes Android.']) + '</div></div><p class="criterio"><strong>Punto de partida</strong> Trabajo local, sin contratar nube ni activar SMS. El plan completo incluye las tareas, dependencias y criterios de las diez fases.</p>')""",
]

final = original[original.index("css = r'''"):]
final = final.replace('10 frentes, presupuesto, contratos y criterios de lanzamiento.', '10 fases de implementación, dependencias, presupuesto y criterios de cierre.')
# Reutilizar los estilos de la plantilla y la navegación ya existentes.
resultado = inicio + funciones + '\n\n'.join(contenido) + '\n\n' + final
ast.parse(resultado)
(BASE / '.build' / 'generador-revision-4.py').write_text(original, encoding='utf-8')
ruta.write_text(resultado, encoding='utf-8')
print('Generador reorganizado por fases; plantilla y navegación conservadas.')
