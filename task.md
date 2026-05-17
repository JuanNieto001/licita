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
