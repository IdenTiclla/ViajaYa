# Generación de la presentación de producción

Desde la raíz del repositorio:

```bash
python3 docs/plans/generador/generar_presentacion.py
```

El generador solo requiere la biblioteca estándar de Python 3. Lee:

- `../plan-salida-produccion.md`: documento íntegro para lectura y descarga;
  también aporta los nombres y estados del resumen F01–F10.
- `production-slides.json`: contenido resumido de las 32 diapositivas, fecha y revisión.
- `presentation.css`: diseño original verde, adaptación móvil e impresión.
- `navegacion.js`: navegación por teclado, selector, vista completa, descarga e impresión.

Escribe `../presentacion-salida-produccion.html` como archivo autónomo. Las
diapositivas y el plan funcionan sin conexión; las fuentes externas requieren red.
Los enlaces a documentos del repositorio requieren conservar la estructura de
carpetas. No descarga dependencias ni consulta servicios.

Para futuras revisiones, actualizar primero el plan y el resumen JSON y regenerar.
El script comprueba coincidencia de fecha/revisión y cobertura de las diez fases.
Revisar en navegador el ajuste de texto, las vistas móvil/escritorio y la impresión.
La descarga `.md` debe coincidir exactamente con el plan fuente.

Los scripts de organización, `fases.json` y los archivos de revisión 4 se conservan
como antecedentes; no son entradas del generador vigente. El comando actual ya
no requiere archivos temporales en `.build`.
