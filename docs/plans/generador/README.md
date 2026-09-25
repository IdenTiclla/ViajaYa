# Generating the production presentation

From the repository root:

```bash
python3 docs/plans/generador/generar_presentacion.py
```

The generator only requires the Python 3 standard library. It reads:

- `../production-launch-plan.md`: the full document for reading and download;
  it also provides the names and statuses of the F01–F10 summary.
- `production-slides.json`: summarized content of the 32 slides, date and revision.
- `presentation.css`: original green design, mobile adaptation and printing.
- `navegacion.js`: keyboard navigation, selector, full view, download and printing.

It writes `../presentacion-salida-produccion.html` as a standalone file. The
slides and the plan work offline; external fonts require network access.
Links to repository documents require keeping the folder
structure. It does not download dependencies or query services.

For future revisions, first update the plan and the JSON summary and regenerate.
The script checks that the date/revision match and that all ten phases are covered.
Review the text wrapping, the mobile/desktop views and printing in a browser.
The `.md` download must match the source plan exactly.

The slides (`production-slides.json`) are user-facing and stay in Spanish; the plan
document is written in English since 2026-09-24. `plan_date` must match the plan's
English date and `phases` holds the Spanish phase names/statuses shown in the deck
(keep them in sync with the phase table of the plan).

The organization scripts, `fases.json` and the revision 4 files are kept
as background; they are not inputs of the current generator. The current command no
longer requires temporary files in `.build`.
