"""Build the standalone production deck from the current plan and slide copy."""

from pathlib import Path
import html
import json
import re

BASE = Path(__file__).resolve().parents[1]
ASSETS = Path(__file__).resolve().parent
PLAN = (BASE / 'plan-salida-produccion.md').read_text(encoding='utf-8')
CONTENT = json.loads((ASSETS / 'production-slides.json').read_text(encoding='utf-8'))


def inline(text):
    """Render the inline Markdown used by the plan, including relative links."""
    escaped = html.escape(text)
    escaped = re.sub(r'`([^`]+)`', r'<code>\1</code>', escaped)
    escaped = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', escaped)

    def link(match):
        label, target = match.groups()
        if not (target.startswith(('https://', '../', '#')) or ':' not in target):
            return label
        external = ' target="_blank" rel="noopener noreferrer"' if target.startswith('https://') else ''
        return f'<a href="{target}"{external}>{label}</a>'

    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, escaped)


def markdown(text):
    """Render the plan's headings, paragraphs, task lists and tables offline."""
    output, paragraph = [], []
    in_list = in_table = False

    def flush_paragraph():
        if paragraph:
            output.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()

    for line in text.splitlines():
        is_list = line.startswith('- ')
        is_table = line.startswith('|')
        heading = re.match(r'^(#{1,6}) (.*)$', line)
        if in_list and not is_list:
            output.append('</ul>')
            in_list = False
        if in_table and not is_table:
            output.append('</tbody></table></div>')
            in_table = False
        if not line.strip() or is_list or is_table or heading:
            flush_paragraph()
        if not line.strip():
            continue
        if is_table:
            if re.fullmatch(r'[|\s:\-]+', line):
                continue
            cells = [inline(cell.strip()) for cell in line.strip('|').split('|')]
            if not in_table:
                output.append('<div class="table-wrap"><table><thead><tr>' + ''.join(f'<th scope="col">{cell}</th>' for cell in cells) + '</tr></thead><tbody>')
                in_table = True
            else:
                output.append('<tr>' + ''.join(f'<td>{cell}</td>' for cell in cells) + '</tr>')
        elif is_list:
            if not in_list:
                output.append('<ul>')
                in_list = True
            item = line[2:]
            mark = ''
            if item.startswith(('[x] ', '[ ] ')):
                checked = item.startswith('[x] ')
                mark = f'<span aria-label="{"Completado" if checked else "Pendiente"}">{"☑" if checked else "☐"}</span> '
                item = item[4:]
            output.append('<li>' + mark + inline(item) + '</li>')
        elif heading:
            level, title = len(heading[1]), heading[2]
            output.append(f'<h{level}>' + inline(title) + f'</h{level}>')
        else:
            paragraph.append(line.strip())
    flush_paragraph()
    if in_list:
        output.append('</ul>')
    if in_table:
        output.append('</tbody></table></div>')
    return '\n'.join(output)


def bullets(items):
    return '<ul class="puntos">' + ''.join('<li>' + inline(item) + '</li>' for item in items) + '</ul>'


phase_rows = re.findall(r'^\| F(\d{2}) \| (.*?) \| (.*?) \| (.*?) \|$', PLAN, re.M)
assert len(phase_rows) == 10, 'The plan must define ten phases.'
PHASES = {int(number): {'title': title, 'status': status.split(':')[0]} for number, title, _, status in phase_rows}
assert f'Revisión {CONTENT["revision"]}' in PLAN, 'Slide revision must match the plan.'
assert CONTENT['date'] in PLAN, 'Slide date must match the plan.'
assert len(CONTENT['slides']) == 32, 'Preserve the 32-slide presentation.'
assert {slide['phase'] for slide in CONTENT['slides'] if 'phase' in slide} == set(range(1, 11))

slides = []
for number, slide in enumerate(CONTENT['slides'], 1):
    title = slide['title']
    phase = slide.get('phase')
    layout = slide.get('layout')
    label = f'FASE {phase:02d} · {PHASES[phase]["status"].upper()}' if phase else 'PLAN DE PRODUCCIÓN · REVISIÓN 10'
    selector_title = (f'F{phase:02d} · ' if phase else '') + title
    body = []
    if layout == 'cover':
        body.extend([
            '<p class="lead">' + '<br>'.join(html.escape(part) for part in slide['lead'].split('<br>')) + '</p>',
            '<p class="cover-meta">' + inline(slide['meta']) + '</p>',
            f'<p class="cover-date">{CONTENT["date"]} · Revisión {CONTENT["revision"]}</p>',
        ])
        label = 'HOJA DE RUTA'
    if slide.get('intro'):
        body.append('<p class="intro">' + inline(slide['intro']) + '</p>')
    if slide.get('stats'):
        body.append('<div class="stats">' + ''.join('<div><strong>' + inline(value) + '</strong><span>' + inline(caption) + '</span></div>' for value, caption in slide['stats']) + '</div>')
    if layout == 'phase-overview':
        body.append('<div class="agenda phase-overview">' + ''.join(f'<div><span>F{key:02d}</span><p>{inline(value["title"])}<small>{inline(value["status"])}</small></p></div>' for key, value in PHASES.items()) + '</div>')
    if slide.get('items'):
        body.append(bullets(slide['items']))
    if slide.get('columns'):
        columns = []
        for column in slide['columns']:
            block = '<h3>' + inline(column['title']) + '</h3>'
            if column.get('items'):
                block += bullets(column['items'])
            if column.get('budget'):
                block += '<div class="budget"><strong>' + inline(column['budget']) + '</strong></div>'
            if column.get('text'):
                block += '<p class="column-text">' + inline(column['text']) + '</p>'
            columns.append('<div>' + block + '</div>')
        body.append('<div class="' + ('triple' if len(columns) == 3 else 'two-col') + '">' + ''.join(columns) + '</div>')
    if slide.get('criterion'):
        body.append('<p class="criterio">' + inline(slide['criterion']) + '</p>')
    if slide.get('source'):
        body.append('<p class="fuente">' + inline(slide['source']) + '</p>')
    title_html = '<br>'.join(html.escape(part) for part in title.split('<br>'))
    slides.append(f'<section class="slide {"cover" if layout == "cover" else ""}" id="slide-{number}" aria-labelledby="title-{number}" data-title="{html.escape(selector_title, quote=True)}"><div class="slide-inner"><header><p class="eyebrow">{label}</p><h2 id="title-{number}" tabindex="-1">{title_html}</h2></header><div class="slide-body">{"".join(body)}</div><footer><span>ViajaYa · Bolivia · Revisión {CONTENT["revision"]}</span><span>{number:02d}</span></footer></div></section>')

css = (ASSETS / 'presentation.css').read_text(encoding='utf-8')
script = (ASSETS / 'navegacion.js').read_text(encoding='utf-8')
plan_json = json.dumps(PLAN, ensure_ascii=False).replace('<', '\\u003c')
page = f'''<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="description" content="Avance de ViajaYa al 19/09/2026: diez fases, evidencia, prioridades y condiciones de salida a producción."><title>ViajaYa — Salida a producción · Revisión {CONTENT["revision"]}</title><style>''' + css + f'''</style></head>
<body><div class="toolbar"><div class="brand">Viaja<span>Ya</span> <span aria-hidden="true">/</span> Producción · rev. {CONTENT["revision"]}</div><nav class="tools" aria-label="Vistas y archivos"><button id="overview" aria-pressed="false">Ver todas</button><button id="reading" aria-pressed="false">Plan completo</button><button id="download">Descargar plan .md</button><button id="print">Imprimir / PDF</button><button id="fullscreen">Pantalla completa</button></nav></div>
<main id="stage" class="stage" aria-label="Presentación del plan">''' + '\n'.join(slides) + '''</main>
<article id="document" class="document" aria-label="Plan de implementación completo" hidden>''' + markdown(PLAN) + '''</article>
<nav class="nav" aria-label="Navegación de diapositivas"><button id="previous" aria-label="Diapositiva anterior">← Anterior</button><label class="sr-only" for="selector">Ir a una diapositiva</label><select id="selector"></select><output id="counter"></output><button id="next" aria-label="Diapositiva siguiente">Siguiente →</button></nav><p class="hint">Flechas para navegar · Inicio / Fin · Esc para volver · Diapositivas y plan disponibles sin conexión</p><div class="progress" aria-hidden="true"><div id="progress-fill"></div></div><p class="sr-only" role="status" aria-live="polite" id="announcer"></p><noscript><style>.slide[hidden]{display:block!important}.toolbar,.nav,.hint,.progress{display:none}.slide{margin-bottom:25px}</style><p>Activa JavaScript para navegar. Las diapositivas se muestran completas a continuación.</p></noscript>
<script id="plan-source" type="application/json">''' + plan_json + '''</script><script>''' + script + '''</script></body></html>'''
output = BASE / 'presentacion-salida-produccion.html'
output.write_text(page, encoding='utf-8')
print(json.dumps({'slides': len(slides), 'revision': CONTENT['revision'], 'output': str(output)}, ensure_ascii=False))
