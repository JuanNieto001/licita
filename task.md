# Analizador de Pliego de Condiciones — Tasks

## Backend

- [x] Instalar dependencias: `pdf-parse` (sin OCR — los PDFs se convierten a `.md` cacheados en disco)
- [x] Crear módulo `backend/src/pdfAnalyzer.js`
  - [x] Descarga del PDF desde SECOP (downloader inyectado vía `setDownloader`)
  - [x] Extracción de texto con `pdf-parse` v2 (`PDFParse.getText()`)
  - [x] Conversión a Markdown (cabeceras de sección detectadas por heurísticas) y cacheo en `backend/data/pliegos/{idDocumento}.md`
  - [x] Selección de pliego: prioriza nombres con "pliego/condiciones/definitivo", castiga "adenda/respuesta/observa/anexo"; cae al PDF más grande si nada matchea
  - [x] Parseo regex de criterios + puntajes sobre el bloque que sigue a "FACTORES/CRITERIOS DE EVALUACIÓN"
  - [x] Devuelve objeto estructurado: `{ documento_analizado, criterios, puntaje_total, advertencias, ... }`
- [x] Endpoint `GET /api/licitaciones/:idPortafolio/analisis-pliego` en `server.js`
- [x] Persistencia en `db.js`: `getAnalisisPliego` con TTL 24h + `setAnalisisPliego`

## Frontend

- [x] Función `fetchAnalisisPliego(id)` en `api.js`
- [x] Modificación de `DetailModal.jsx`:
  - [x] Botón "Analizar pliego de condiciones"
  - [x] Sección de resultados: tabla de criterios con puntajes (+ fila de total)
  - [x] Skeletons + banner de error + banner amarillo de advertencias
  - [x] Botón "Descargar resumen PDF"
- [x] Generación de PDF en el navegador con `jsPDF`

## Verificación

- [x] Smoke test backend con 4 licitaciones:
  - `CO1.BDOS.4769228` (LP 01 2023, CAR Nariño) → 6 criterios, total 100 ✓
  - `CO1.BDOS.2886732` (Polideportivo Rosas) → 4 criterios, total 100 ✓
  - `CO1.BDOS.462604` (Obra Melgar) → 4 criterios, total 100 ✓
  - `CO1.BDOS.1491612` (Quibdó iluminación) → advertencia honesta "no se identificó sección" (formato distinto)
- [x] Cache `db.js` confirmado (segunda llamada < 5ms con `desde_cache: true`)
- [x] Cache `.md` confirmado (`markdown_cacheado: true` tras invalidar análisis pero conservar el .md)
- [ ] **Pendiente**: probar la UI en el navegador (backend + frontend ya están corriendo en 4000 / 5173). Abrir <http://localhost:5173>, buscar `LP 01 DE 2023` o filtrar por modalidad "Licitación pública", abrir el detalle, click en "Analizar pliego de condiciones", y verificar:
  - Skeleton + tabla con 6 criterios + fila total
  - Botón "Descargar resumen PDF" genera un PDF legible

## Notas de implementación

- Sin OCR. Los PDFs escaneados devuelven advertencia clara y `criterios: []`.
- Doble nivel de caché: `.md` por documento en disco (reutilizable aunque expire el TTL) + análisis JSON en `db.js` por 24h.
- pdf-parse instalado fue v2.4.5 — API nueva (`new PDFParse({ data }).getText()` en vez de `pdfParse(buffer)`).
- Heurística de extracción afinada en 2 iteraciones:
  1. Selección de bloque: priorizar matches que sean encabezados markdown (`##`); rechazar la primera ocurrencia si su ventana de 8 líneas tiene ≥3 patrones TOC (línea con `..... NN`); como último recurso aceptar matches en prosa.
  2. Corte del bloque: parar al ver "Total NN", otro `##`, o 4 líneas consecutivas sin match (filtra falsos positivos del párrafo siguiente).
- Soporte para decimales con coma (`39,75` → 39.75) y unidades `puntos|pts|%`.
- jsPDF v3.x importa `canvg` / `html2canvas` / `dompurify` dinámicamente — solo se usan para SVG/HTML, no para texto. Vite no resuelve esos imports dinámicos, así que los aliasé a `frontend/src/empty-module.js` en `vite.config.js`.

## Robustez del encuentro y suma de puntajes (hardening)

Revisión de inconsistencias sobre 25 pliegos cacheados + 2 pliegos reales del repo
(LP-005, LP-012). Cambios en `backend/src/pdfAnalyzer.js`:

1. **Nombres mutilados por filas partidas (defecto dominante).** `pdfAMarkdown`
   parte un criterio en dos líneas ("Vinculación de personas con" / "discapacidad 1").
   El extractor de bloque no reunía el prefijo y devolvía "discapacidad", "nacional",
   "empresas de mujeres", "ambiental agregado"… El mismo pliego salía limpio o sucio
   según qué ruta ganara (p.ej. `755689780` vs `755689900`, idénticos). Solución:
   - `extraerCuadroPuntaje` reconstruye el prefijo desde líneas de texto plano y,
     en tablas EN MAYÚSCULAS, también desde filas `## …` (solo en "modo mayúsculas",
     para no pegar encabezados de página tipo `## DOCUMENTO BASE`).
   - `scoreCandidato` penaliza nombres que empiezan en minúscula (fragmento) y premia
     nombres completos, así la candidata mejor reconstruida gana los empates.
2. **Tablas EN MAYÚSCULAS rechazadas.** Una tabla "## PROPUESTA ECONÓMICA 185 …
   ## TOTAL 1000 PUNTOS" se convertía toda en encabezados markdown y se descartaba.
   Ahora se destapa el marcador `##` para leer la fila como dato, y el cierre "Total"
   se detecta también sin marcador. Recupera `65972463` (→1000) y `726985405` (→100).
3. **Compuerta todo-o-nada → niveles de confianza.** Antes, si la tabla no sumaba
   exactamente 100/1000 se descartaba TODO ("no se identificó sección"). Ahora:
   - Nivel 1 (alta confianza): total == 100 (±1) o == 1000 (±10).
   - Nivel 2 (baja confianza): la mejor tabla "casi completa" (≥4 criterios, puntajes
     en la columna derecha) cerca de 100/1000 se devuelve marcada `suma_confiable:false`
     con una advertencia, en vez de descartarse. Una fila perdida ya no anula todo.
   - El análisis expone `suma_confiable` y `escala_puntaje`; el frontend pinta la fila
     Total en ámbar con "(no suma N — verificar)" cuando la suma no es confiable.

Resultado: 2 pliegos recuperados (0→correcto), ~9 con nombres ahora completos,
0 regresiones (todos los que sumaban 100/1000 siguen igual con nombres iguales o
mejores). Los que siguen en 0 son escaneados sin texto, sin cuadro-resumen real, o
tablas jerárquicas con subtotal de grupo (no se inventan datos).
