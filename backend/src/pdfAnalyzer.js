import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { getDocumentosPorProceso } from "./socrata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLIEGOS_DIR = path.join(__dirname, "..", "data", "pliegos");

const SECOP_DOC_BASE =
  "https://community.secop.gov.co/Public/Archive/RetrieveFile/Index";

function buildDocUrl(documentId) {
  return `${SECOP_DOC_BASE}?DocumentId=${encodeURIComponent(documentId)}&InCommunity=False&InPaymentGateway=False&DocUniqueIdentifier=`;
}

let _downloader = null;
export function setDownloader(fn) {
  _downloader = fn;
}

function nombreNormalizado(d) {
  return (d?.nombre_archivo || "").toLowerCase();
}

export function esPdf(d) {
  const ext = (d?.extensi_n || "").toLowerCase().replace(/^\./, "");
  return ext === "pdf" || nombreNormalizado(d).endsWith(".pdf");
}

export function elegirPliego(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const pdfs = docs.filter(esPdf);
  if (!pdfs.length) return null;

  const score = (d) => {
    const n = nombreNormalizado(d);
    // Variante con separadores (_ - .) como espacios, para nombres tipo
    // "documento_base.pdf" o "doc-base-definitivo.pdf".
    const ns = n.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
    let s = 0;
    // Palabras clave positivas — nombre completo y abreviaciones
    if (n.includes("pliego") || n.includes("plieg")) s += 12;
    // "Documento base" — nombre alternativo del pliego de condiciones en SECOP II
    if (ns.includes("documento base") || n.includes("documentobase")) s += 12;
    if (ns.includes("doc base") || ns.includes("docbase")) s += 10;
    // "base" junto a otras señales del pliego ("pliego base", "base definitivo")
    if (ns.includes("base") && (n.includes("plieg") || n.includes("definit")))
      s += 4;
    if (n.includes("condiciones")) s += 6;
    if (n.includes("condic") && !n.includes("condiciones")) s += 4;
    if (n.includes("definitivo")) s += 10;
    if (n.includes("definit") && !n.includes("definitivo")) s += 7;
    if (/\bdef\b/.test(n) || n.endsWith(" def") || n.endsWith("_def")) s += 5;
    if (n.includes("proyecto")) s += 2;
    // Penalizaciones — documentos que no son el pliego
    if (n.includes("adenda")) s -= 15;
    if (n.includes("respuesta")) s -= 12;
    if (n.includes("observa")) s -= 10;
    if (n.includes("anexo")) s -= 6;
    if (n.includes("acta")) s -= 8;
    if (n.includes("resoluci")) s -= 8;
    if (n.includes("informe")) s -= 5;
    if (n.includes("aviso")) s -= 8;
    if (n.includes("formato")) s -= 4;
    return s;
  };

  const ranked = [...pdfs].sort((a, b) => {
    const sb = score(b);
    const sa = score(a);
    if (sb !== sa) return sb - sa;
    return (Number(b.tamanno_archivo) || 0) - (Number(a.tamanno_archivo) || 0);
  });

  const top = ranked[0];
  // Si el mejor candidato tiene score ≤ 0 no es un pliego reconocible → error
  if (score(top) <= 0) {
    return null;
  }

  return {
    id: top.id_documento,
    nombre: top.nombre_archivo,
    tamano: Number(top.tamanno_archivo) || 0,
  };
}

function lineaEsMayusculas(linea) {
  const limpia = linea.trim();
  if (limpia.length < 4) return false;
  const letras = limpia.replace(/[^A-ZÁÉÍÓÚÑa-záéíóúñ]/g, "");
  if (letras.length < 4) return false;
  return letras === letras.toUpperCase();
}

export function textoAMarkdown(text, titulo = "Pliego de condiciones", numpages = 0) {
  const lineas = text.split(/\r?\n/);
  const out = [];
  out.push(`# ${titulo}`);
  out.push(`_Páginas: ${numpages || "?"}_`);
  out.push("");

  for (const raw of lineas) {
    const linea = raw.replace(/\s+$/g, "");
    if (!linea.trim()) {
      out.push("");
      continue;
    }
    const mNum = linea.match(/^\s*(\d+(?:\.\d+)*)\s+([A-ZÁÉÍÓÚÑ].+)$/);
    if (mNum) {
      out.push(`### ${mNum[1]} ${mNum[2]}`);
      continue;
    }
    if (lineaEsMayusculas(linea)) {
      out.push(`## ${linea.trim()}`);
      continue;
    }
    out.push(linea);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function pdfAMarkdown(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let text = "";
  let numpages = 0;
  let titulo = "Pliego de condiciones";
  try {
    const textResult = await parser.getText();
    text = textResult?.text || "";
    numpages = textResult?.total || textResult?.pages?.length || 0;
    try {
      const infoResult = await parser.getInfo();
      const t = infoResult?.info?.Title;
      if (t && typeof t === "string" && t.trim()) titulo = t.trim();
    } catch {}
  } finally {
    try {
      await parser.destroy();
    } catch {}
  }

  return textoAMarkdown(text, titulo, numpages);
}

// Descarga el PDF del pliego (con caché en disco) y devuelve su buffer.
async function obtenerPdfPliego(doc) {
  fs.mkdirSync(PLIEGOS_DIR, { recursive: true });
  const pdfPath = path.join(PLIEGOS_DIR, `${doc.id}.pdf`);
  if (fs.existsSync(pdfPath)) {
    return { buffer: fs.readFileSync(pdfPath), cacheado: true };
  }

  if (!_downloader) {
    throw new Error("Downloader no configurado (llamar setDownloader)");
  }
  const url = buildDocUrl(doc.id);
  const upstream = await _downloader(url);
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    throw new Error(
      `No se pudo descargar el PDF (HTTP ${upstream.statusCode})`,
    );
  }
  const chunks = [];
  for await (const c of upstream.body) chunks.push(c);
  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(pdfPath, buffer);
  return { buffer, cacheado: false };
}

async function obtenerMarkdownPliego(doc, buffer) {
  fs.mkdirSync(PLIEGOS_DIR, { recursive: true });
  const mdPath = path.join(PLIEGOS_DIR, `${doc.id}.md`);
  if (fs.existsSync(mdPath)) {
    return { md: fs.readFileSync(mdPath, "utf8"), cacheado: true };
  }
  const md = await pdfAMarkdown(buffer);
  fs.writeFileSync(mdPath, md, "utf8");
  return { md, cacheado: false };
}

// ===== OCR (solo para PDFs escaneados, sin capa de texto) =====

let _ocrWorkerPromise = null;
async function getOcrWorker() {
  if (!_ocrWorkerPromise) {
    _ocrWorkerPromise = createWorker("spa", 1, {
      cachePath: path.join(__dirname, "..", "data", "ocr"),
    });
  }
  return _ocrWorkerPromise;
}

/**
 * OCR página por página sobre el PDF escaneado. Para no procesar pliegos de
 * cientos de páginas completos, se detiene unas páginas después de encontrar
 * la tabla de criterios (palabras "puntaje"/"desempate" + criterios extraíbles).
 * El resultado se cachea en disco como `<id>.ocr.md`.
 */
async function ocrAMarkdown(doc, buffer, { maxPaginas = 120 } = {}) {
  fs.mkdirSync(PLIEGOS_DIR, { recursive: true });
  const mdPath = path.join(PLIEGOS_DIR, `${doc.id}.ocr.md`);
  if (fs.existsSync(mdPath)) {
    return { md: fs.readFileSync(mdPath, "utf8"), cacheado: true };
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const partes = [];
  try {
    const worker = await getOcrWorker();
    let total = maxPaginas;
    try {
      const t = await parser.getText();
      total = t?.total || maxPaginas;
    } catch {}
    const max = Math.min(total, maxPaginas);

    let encontradoEn = -1;
    for (let p = 1; p <= max; p++) {
      const shot = await parser.getScreenshot({
        partial: [p],
        scale: 2,
        imageBuffer: true,
      });
      const img = shot?.pages?.[0]?.data;
      if (!img) continue;
      const { data } = await worker.recognize(Buffer.from(img));
      partes.push(data?.text || "");

      if (encontradoEn < 0) {
        const acumulado = partes.join("\n");
        if (/puntaje|desempate/i.test(acumulado)) {
          const r = extraerCriterios(textoAMarkdown(acumulado));
          if (r.criterios.length >= 2) encontradoEn = p;
        }
      }
      // La tabla puede continuar en las páginas siguientes: leer 3 extra.
      if (encontradoEn > 0 && p >= encontradoEn + 3) break;
    }
  } finally {
    try {
      await parser.destroy();
    } catch {}
  }

  const md = textoAMarkdown(partes.join("\n"), "Pliego (OCR)", partes.length);
  fs.writeFileSync(mdPath, md, "utf8");
  return { md, cacheado: false };
}

/**
 * Detecta si el PDF es un documento escaneado (páginas que son imágenes).
 * Casos: sin capa de texto, o con capa de texto OCR de baja calidad incrustada
 * por el escáner. Se muestrean hasta 5 páginas repartidas: si casi todas
 * contienen una imagen de tamaño página, es un escaneo.
 */
async function esPdfEscaneado(buffer, mdLen) {
  if (mdLen < 500) return true;
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    let total = 0;
    try {
      total = (await parser.getInfo())?.total || 0;
    } catch {}
    if (!total) return false;
    const muestras = [
      ...new Set(
        [1, 0.25, 0.5, 0.75, 1].map((f, idx) =>
          idx === 0 ? 1 : Math.max(1, Math.round(total * f)),
        ),
      ),
    ];
    let conImagenGrande = 0;
    for (const p of muestras) {
      const res = await parser
        .getImage({ partial: [p], imageBuffer: false, imageDataUrl: false })
        .catch(() => null);
      const imgs = res?.pages?.[0]?.images || [];
      if (imgs.some((im) => (im.width || 0) >= 700 && (im.height || 0) >= 900)) {
        conImagenGrande++;
      }
    }
    return conImagenGrande >= Math.ceil(muestras.length * 0.8);
  } finally {
    try {
      await parser.destroy();
    } catch {}
  }
}

// ===== Tablas vectoriales =====

/**
 * Extrae los criterios directamente de las tablas dibujadas del PDF
 * (getTable reconstruye filas/columnas a partir de las líneas vectoriales y
 * asigna cada texto a su celda). Mucho más fiel que leer el texto plano:
 * cada puntaje sale de su propia celda, tal cual está en el pliego.
 * Devuelve null si ninguna tabla con encabezado PUNTAJE suma un total válido.
 */
export async function extraerCriteriosDeTabla(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let tablas = [];
  try {
    const res = await parser.getTable();
    tablas = res?.mergedTables?.length
      ? res.mergedTables
      : (res?.pages || []).flatMap((pg) => pg.tables || []);
  } finally {
    try {
      await parser.destroy();
    } catch {}
  }

  const candidatos = [];
  for (const tabla of tablas) {
    if (!Array.isArray(tabla) || tabla.length < 2) continue;
    const norm = tabla.map((row) =>
      (row || []).map((c) => String(c ?? "").replace(/\s+/g, " ").trim()),
    );
    // El encabezado del cuadro de criterios menciona PUNTAJE en las primeras filas
    const headerIdx = norm.findIndex(
      (row, i) => i < 3 && row.some((c) => /puntaje/i.test(c)),
    );
    if (headerIdx === -1) continue;

    const criterios = [];
    const vistos = new Set();
    for (const row of norm.slice(headerIdx + 1)) {
      const celdas = row.filter(Boolean);
      if (!celdas.length) continue;
      if (/^total\b/i.test(celdas[0])) continue;
      const nombre = limpiarNombreCriterio(celdas[0]);
      let puntaje = NaN;
      let unidad = "puntos";
      // El puntaje es la última celda numérica de la fila (columna derecha)
      for (let j = celdas.length - 1; j >= 1; j--) {
        const v = parsearNumero(celdas[j]);
        if (Number.isFinite(v) && v > 0) {
          puntaje = v;
          if (celdas[j].includes("%")) unidad = "%";
          break;
        }
      }
      const letras = (nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
      if (!nombre || letras < 3 || nombre.length > 160) continue;
      if (NOMBRES_EXCLUIDOS.has(nombre.toLowerCase())) continue;
      if (!Number.isFinite(puntaje) || puntaje <= 0 || puntaje > 1000) continue;
      const key = nombre.toLowerCase();
      if (vistos.has(key)) continue;
      vistos.add(key);
      criterios.push({
        nombre,
        puntaje: Math.round(puntaje * 100) / 100,
        unidad,
      });
    }
    if (criterios.length >= 2) {
      const puntajeTotal =
        Math.round(criterios.reduce((s, c) => s + c.puntaje, 0) * 100) / 100;
      candidatos.push({ criterios, puntajeTotal });
    }
  }

  if (!candidatos.length) return null;
  // Mismo criterio de validación que el extractor de texto: el cuadro real
  // suma 100 (±1) o, como último recurso, 1000 (±10).
  const cerca = (objetivo, tol) =>
    candidatos.filter((c) => Math.abs(c.puntajeTotal - objetivo) <= tol);
  const elegibles = cerca(100, 1).length ? cerca(100, 1) : cerca(1000, 10);
  if (!elegibles.length) return null;
  return elegibles.reduce((a, b) =>
    b.criterios.length > a.criterios.length ? b : a,
  );
}

// Patrones para "desempate" — búsqueda primaria
const DESEMPATE_PATTERNS = [
  /criterios?\s+de\s+evaluaci[oó]n.*asignaci[oó]n.*puntaje.*criterios?\s+de\s+desempate/i,
  /asignaci[oó]n\s+de\s+puntaje.*desempate/i,
  /criterios?\s+de\s+desempate/i,
  /desempate/i,
];

// Patrones fallback — encabezados clásicos de sección de criterios
const ENCABEZADOS_CRITERIOS = [
  /factores?\s+de\s+evaluaci[oó]n/i,
  /criterios?\s+de\s+evaluaci[oó]n/i,
  /criterios?\s+de\s+ponderaci[oó]n/i,
  /criterios?\s+de\s+calificaci[oó]n/i,
  /evaluaci[oó]n\s+y\s+calificaci[oó]n/i,
  /asignaci[oó]n\s+de\s+puntaje/i,
  /puntajes?\s+a\s+asignar/i,
];

// Encabezados de un "cuadro de puntajes": una fila de títulos de tabla que
// menciona PUNTAJE (p.ej. "FACTOR PUNTAJE MÁXIMO", "DESCRIPCIÓN PUNTAJE",
// "EXPERIENCIA GENERAL PUNTAJE"). El formato varía y el cuadro puede partirse en
// varias páginas, por eso se extrae con un lector tolerante (extraerCuadroPuntaje).
const ENCABEZADOS_PUNTAJE = [
  /^#{0,6}\s*(?:factor|concepto|descripci[oó]n|criterio|item|[ií]tem|experiencia)\b.*\bpuntaje/i,
  /\bpuntaje\s+m[áa]xim[oa]\b/i,
  /^#{1,6}\s+.*\bpuntajes?\s*$/i, // encabezado markdown que TERMINA en "PUNTAJE"
  /^#{0,6}\s*.{0,18}\bpuntajes?\s*$/i, // encabezado de columna corto ("Puntaje")
];

const REGEX_TOC = /\.{3,}\s*\d{1,3}\s*$/;
const NOMBRES_EXCLUIDOS = new Set([
  "total",
  "puntaje",
  "puntaje maximo",
  "puntaje máximo",
  "concepto",
  "criterio",
  "factor",
  "máximo",
  "maximo",
]);

// Líneas que claramente no son criterios (paginación, identificadores, datos de
// contacto del organismo contratante, encabezados de tabla, etc.). Si la línea
// contiene cualquiera de estas marcas, se descarta antes de aplicar regex.
const REGEX_LINEAS_NO_CRITERIO = [
  // Encabezados/pies de página: toleran ":" tras la etiqueta
  // ("Página: 16 de 75", "Versión No.: 8", "Código: CCE-EICP-GI-01").
  /\bp[áa]gina\s*:?\s*\d+\s+de\s+\d+/i,
  /\bversi[óo]n\s*(?:n[o°º]\.?)?\s*:?\s*\d/i,
  /\bc[óo]digo\s*:?\s*[A-Z]/i,
  /\bc[óo]digo\s+postal/i,
  /\bNIT\b/i,
  /\bcra?\.?\s+\d+/i,
  /\bcalle\s+\d+/i,
  /\btel[ée]fono|\btel[.:]\s*\(?\d/i,
  /^no\.?\s+\d+\s*$/i,
];

// Regex para detectar una línea que parece ser una fila de tabla de puntajes:
// texto descriptivo seguido de un número al EXTREMO DERECHO de la línea.
// Esto es la firma de "puntaje como columna derecha".
const REGEX_FILA_TABLA_PUNTAJE = /^.{4,}\s+(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:puntos|pts|%)?\.?\s*$/i;

function limpiarNombreCriterio(nombre) {
  return nombre
    .replace(/\.{2,}/g, "")
    .replace(/_+/g, " ")
    .replace(/^\s*\d+(\.\d+)*\s*[-.)]?\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parsearNumero(s) {
  if (!s) return NaN;
  const limpio = String(s).replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");
  const conPunto = limpio.replace(",", ".");
  return Number(conPunto);
}

/**
 * Verifica que cerca de una línea candidata (hacia abajo) haya líneas con
 * puntajes numéricos EN EL EXTREMO DERECHO (columna derecha de una tabla).
 * Esto distingue la tabla de puntajes de menciones textuales o tablas
 * donde los números están en el medio.
 */
function tieneTablaPuntajesCerca(lineas, idx, ventana = 40) {
  let filasConPuntajeDerecho = 0;
  const fin = Math.min(lineas.length, idx + ventana);
  for (let i = idx + 1; i < fin; i++) {
    const l = lineas[i].trim();
    if (!l) continue;
    if (REGEX_TOC.test(l)) continue;
    if (REGEX_FILA_TABLA_PUNTAJE.test(l)) filasConPuntajeDerecho++;
  }
  return filasConPuntajeDerecho >= 2;
}

/**
 * Extrae criterios de un bloque específico de líneas.
 * Retorna { criterios, puntajeTotal } o null si no se encontraron criterios válidos.
 */
function extraerCriteriosDeBloque(lineas, inicio) {
  const maxLineas = 400;
  let fin = Math.min(lineas.length, inicio + maxLineas);
  for (let i = inicio + 4; i < fin; i++) {
    if (/^##\s+CAP[IÍ]TULO\s+/i.test(lineas[i])) {
      fin = i;
      break;
    }
  }
  const bloque = lineas.slice(inicio, fin);

  // Total/Total Puntos/Total Puntaje XX — cierre del bloque de criterios.
  const REGEX_TOTAL = /^total(?:\s+(?:puntos?|puntaje|m[áa]ximo))?\s*[:.]?\s*\d+(?:[.,]\d+)?\s*$/i;

  const patrones = [
    {
      re: /^(.+?)\s+(\d{1,4}(?:[.,]\d{1,3})?)\s*(puntos|pts|%)\s*$/i,
      withUnit: true,
    },
    {
      // Separador `:` admite cualquier contexto; los guiones requieren espacio
      // antes para no capturar NITs ("899.999.475-4") ni códigos ("CCE-EICP-GI-02").
      re: /^(.+?)(?::\s*|\s+[\-–]\s*)(\d{1,4}(?:[.,]\d{1,3})?)\s*(puntos|pts|%)?$/i,
      withUnit: false,
    },
    {
      re: /^(.+?)\s+(\d{1,3}(?:[.,]\d{1,3})?)\s*$/,
      withUnit: false,
    },
  ];

  const criterios = [];
  const vistos = new Set();
  let lineasSinMatch = 0;
  // Primera mitad de una fila partida en dos líneas
  // ("Vinculación de personas con" + "discapacidad 1").
  let prefijo = "";

  for (const raw of bloque) {
    const linea = raw.trim();
    if (!linea) continue;
    if (/^#{1,6}\s/.test(linea)) {
      if (criterios.length > 0) break;
      continue;
    }
    if (REGEX_TOTAL.test(linea)) {
      if (criterios.length > 0) break;
      continue;
    }
    if (REGEX_TOC.test(linea)) continue;
    if (/^[-_=*•]+$/.test(linea)) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(linea)) continue;
    if (REGEX_LINEAS_NO_CRITERIO.some((re) => re.test(linea))) continue;

    let capturado = false;
    for (const { re, withUnit } of patrones) {
      const m = linea.match(re);
      if (!m) continue;
      // Si el fragmento empieza en minúscula es la continuación de la línea
      // anterior: reconstruir el nombre completo de la fila partida.
      const fragmento = m[1].trim();
      const nombre =
        prefijo && /^[a-záéíóúñ]/.test(fragmento)
          ? limpiarNombreCriterio(`${prefijo} ${fragmento}`)
          : limpiarNombreCriterio(fragmento);
      const puntaje = parsearNumero(m[2]);
      if (!nombre || nombre.length < 3 || nombre.length > 140) break;
      if (NOMBRES_EXCLUIDOS.has(nombre.toLowerCase())) break;
      // El nombre debe empezar por letra (descarta números y filas de tablas con
      // columnas mal alineadas como ",51 Mayores" o "0,75 ...").
      if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ(]/.test(nombre)) break;
      // …y tener contenido alfabético real (evita "0,51 0,75", "1,00 1,50").
      const letras = (nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
      if (letras < 3) break;
      if (!Number.isFinite(puntaje) || puntaje <= 0 || puntaje > 1000) break;

      const unidad = (m[3] || "").toLowerCase().includes("%")
        ? "%"
        : "puntos";

      if (!withUnit && puntaje > 100 && unidad === "puntos") break;
      if (!withUnit && nombre.length > 80) break;

      const key = nombre.toLowerCase();
      if (vistos.has(key)) break;
      vistos.add(key);
      criterios.push({
        nombre,
        puntaje: Math.round(puntaje * 100) / 100,
        unidad,
      });
      capturado = true;
      break;
    }

    // Número solo en su propia línea: cierre de una fila partida en varias
    // ("Vinculación de / personas con / discapacidad" y luego "1").
    if (!capturado && prefijo && criterios.length > 0) {
      const mSolo = linea.match(
        /^(\d{1,3}(?:[.,]\d{1,3})?)\s*(puntos|pts|%)?\.?\s*$/i,
      );
      if (mSolo) {
        const nombre = limpiarNombreCriterio(prefijo);
        const puntaje = parsearNumero(mSolo[1]);
        const letras = (nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
        const key = nombre.toLowerCase();
        if (
          nombre &&
          letras >= 3 &&
          nombre.length <= 140 &&
          /^[A-Za-zÁÉÍÓÚÑáéíóúñ(]/.test(nombre) &&
          !NOMBRES_EXCLUIDOS.has(key) &&
          !vistos.has(key) &&
          Number.isFinite(puntaje) &&
          puntaje > 0 &&
          puntaje <= 100
        ) {
          vistos.add(key);
          criterios.push({
            nombre,
            puntaje: Math.round(puntaje * 100) / 100,
            unidad: (mSolo[2] || "").includes("%") ? "%" : "puntos",
          });
          capturado = true;
        }
      }
    }

    if (capturado) {
      lineasSinMatch = 0;
      prefijo = "";
    } else {
      // Línea con texto pero sin número al final: fragmento de una fila
      // partida en varias líneas — se acumula hasta encontrar el puntaje.
      const letras = (linea.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
      if (letras >= 3 && !/\d\s*$/.test(linea) && linea.length <= 100) {
        const combinado = prefijo ? `${prefijo} ${linea}` : linea;
        prefijo = combinado.length <= 160 ? combinado : linea;
      } else {
        prefijo = "";
      }
      if (criterios.length > 0) {
        lineasSinMatch++;
        if (lineasSinMatch >= 4) break;
      }
    }
  }

  if (criterios.length === 0) return null;

  const puntajeTotal =
    Math.round(criterios.reduce((s, c) => s + c.puntaje, 0) * 100) / 100;
  return { criterios, puntajeTotal };
}

// Ruido de corte de página: cabeceras/pies repetidos del PDF que se cuelan dentro
// de un cuadro cuando éste se parte entre páginas. Deben ignorarse, NO cerrar el
// cuadro de puntajes.
function esRuidoDePagina(linea) {
  const l = linea.trim();
  if (!l) return true;
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(l)) return true; // "-- 61 of 148 --"
  if (/^\d{1,4}$/.test(l)) return true; // número de página suelto
  if (/@/.test(l)) return true; // correos del pie de página
  if (/^fecha\b/i.test(l)) return true;
  if (REGEX_TOC.test(l)) return true;
  if (REGEX_LINEAS_NO_CRITERIO.some((re) => re.test(l))) return true;
  // Encabezado del documento convertido a "## ENTIDAD…" (no numerado).
  if (/^#{1,6}\s+(municipio|departamento|proceso|servicios|alcald[ií]a|gobernaci[oó]n|secretar[ií]a|nit|empresa|instituto)\b/i.test(l))
    return true;
  return false;
}

// Una nueva sección numerada ("## 2.6.1. …", "### 4 …") cierra el cuadro.
function esEncabezadoSeccionNumerada(linea) {
  return /^#{1,6}\s+\d/.test(linea.trim());
}

// Cierre del cuadro: fila "Total … N".
const REGEX_TOTAL_CUADRO =
  /^total(?:\s+(?:de\s+)?(?:puntos?|puntaje|m[áa]ximo))?\s*[:.]?\s*\d+(?:[.,]\d+)?\s*(?:puntos?|pts)?\.?\s*$/i;

/**
 * Lee un "cuadro de puntajes" (filtro extra pedido): un cuadro encabezado por una
 * fila que dice PUNTAJE. Es TOLERANTE a cortes de página (salta cabeceras/pies que
 * se repiten) y reconstruye filas partidas en dos líneas ("nombre…" + "resto N").
 * Cierra al llegar a "Total N" o a una nueva sección numerada.
 */
function extraerCuadroPuntaje(lineas, inicio) {
  const fin = Math.min(lineas.length, inicio + 120);
  const criterios = [];
  const vistos = new Set();
  let prefijo = ""; // primera parte de una fila partida en dos líneas
  let sinMatch = 0;

  for (let i = inicio + 1; i < fin; i++) {
    const linea = lineas[i].trim();
    if (esRuidoDePagina(linea)) continue; // saltar cortes de página
    if (esEncabezadoSeccionNumerada(linea)) break; // nueva sección → fin del cuadro
    if (REGEX_TOTAL_CUADRO.test(linea)) break; // "Total 1000 puntos" → cierra el cuadro

    const m = linea.match(/^(.+?)\s+(\d{1,4}(?:[.,]\d{1,3})?)\s*(puntos?|pts|%)?\.?\s*$/i);
    if (m) {
      const nombre = limpiarNombreCriterio((prefijo ? `${prefijo} ` : "") + m[1]);
      prefijo = "";
      const puntaje = parsearNumero(m[2]);
      const letras = (nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
      const valido =
        nombre &&
        nombre.length >= 3 &&
        nombre.length <= 160 &&
        letras >= 3 &&
        /^[A-Za-zÁÉÍÓÚÑáéíóúñ(]/.test(nombre) &&
        !NOMBRES_EXCLUIDOS.has(nombre.toLowerCase()) &&
        Number.isFinite(puntaje) &&
        puntaje > 0 &&
        puntaje <= 1000;
      if (valido && !vistos.has(nombre.toLowerCase())) {
        vistos.add(nombre.toLowerCase());
        criterios.push({
          nombre,
          puntaje: Math.round(puntaje * 100) / 100,
          unidad: (m[3] || "").includes("%") ? "%" : "puntos",
        });
        sinMatch = 0;
        continue;
      }
    }

    // Texto sin número: puede ser la primera parte de una fila partida en dos.
    // Ignoramos remanentes de encabezado ("máximo", "puntaje", "factor", …).
    if (
      /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(linea) &&
      !/^#{1,6}\s/.test(linea) &&
      !/^(puntaje|m[áa]xim[oa]|factor|concepto|descripci[oó]n|criterio|item|[ií]tem)\b/i.test(linea)
    ) {
      prefijo = linea;
    }
    sinMatch++;
    if (criterios.length > 0 && sinMatch >= 6) break;
  }

  if (criterios.length === 0) return null;
  const puntajeTotal =
    Math.round(criterios.reduce((s, c) => s + c.puntaje, 0) * 100) / 100;
  return { criterios, puntajeTotal };
}

/**
 * Cuadros "por columnas": algunos PDFs entregan el texto del cuadro columna a
 * columna — primero el encabezado PUNTAJE con la lista de valores ("599 puntos",
 * "180 puntos", …) y después el encabezado FACTOR/CRITERIO con la lista de
 * nombres. Se emparejan por posición; si sobra un valor y coincide con la suma
 * de los demás, es la fila TOTAL y se descarta.
 */
function extraerColumnasFactorPuntaje(lineas) {
  const candidatos = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!/^#{0,6}\s*puntajes?\s*$/i.test(lineas[i].trim())) continue;

    // Columna de valores: líneas consecutivas "N puntos" (tolera OCR "puntOs")
    const valores = [];
    let j = i + 1;
    for (; j < lineas.length && valores.length < 30; j++) {
      const l = lineas[j].trim();
      if (!l) continue;
      const m = l.match(/^(\d{1,4}(?:[.,]\d{1,3})?)\s*punt\w*\.?\s*$/i);
      if (!m) break;
      valores.push(parsearNumero(m[1]));
    }
    if (valores.length < 3) continue;

    // Encabezado de la columna de nombres en las siguientes líneas
    let k = j;
    let okHeader = false;
    for (let c = 0; k < lineas.length && c < 4; k++) {
      const l = lineas[k].trim();
      if (!l) continue;
      c++;
      if (/^#{0,6}\s*(factor|criterio|concepto)e?s?\s*$/i.test(l)) {
        okHeader = true;
        k++;
        break;
      }
    }
    if (!okHeader) continue;

    // Columna de nombres hasta TOTAL o nuevo encabezado
    const nombres = [];
    for (; k < lineas.length && nombres.length < valores.length + 2; k++) {
      const l = lineas[k].trim();
      if (!l) continue;
      if (/^#{0,6}\s*total\b/i.test(l)) break;
      if (/^#{1,6}\s/.test(l) && nombres.length) break;
      const nombre = limpiarNombreCriterio(l.replace(/^#{1,6}\s*/, ""));
      const letras = (nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
      if (letras < 3 || nombre.length > 160) continue;
      if (NOMBRES_EXCLUIDOS.has(nombre.toLowerCase())) continue;
      nombres.push(nombre);
    }
    if (!nombres.length) continue;

    // Valor extra que iguala la suma de los demás = fila TOTAL
    let vals = valores;
    if (valores.length === nombres.length + 1) {
      const suma = valores.slice(0, -1).reduce((a, b) => a + b, 0);
      if (Math.abs(suma - valores[valores.length - 1]) <= 1) {
        vals = valores.slice(0, -1);
      }
    }
    if (vals.length !== nombres.length) continue;
    if (vals.some((v) => !Number.isFinite(v) || v <= 0 || v > 1000)) continue;

    const criterios = nombres.map((nombre, idx) => ({
      nombre,
      puntaje: Math.round(vals[idx] * 100) / 100,
      unidad: "puntos",
    }));
    const puntajeTotal =
      Math.round(criterios.reduce((s, c) => s + c.puntaje, 0) * 100) / 100;
    candidatos.push({ criterios, puntajeTotal });
  }
  return candidatos;
}

/**
 * Desempata entre tablas candidatas YA validadas (suman ~100, ver buscarMejorTabla).
 * Prefiere la que tiene más criterios y la que trae los puntajes en la columna del
 * extremo derecho.
 */
function scoreCandidato(resultado, puntajeDerecho = false) {
  if (!resultado || resultado.criterios.length === 0) return -Infinity;
  let score = resultado.criterios.length * 2; // más criterios = mejor
  if (puntajeDerecho) score += 40; // puntajes en la columna del extremo derecho
  return score;
}

/**
 * Recolecta TODAS las posiciones candidatas de tablas de puntajes,
 * extrae los criterios de cada una, y devuelve la mejor.
 */
function buscarMejorTabla(lineas) {
  // posición → ¿tiene la tabla los puntajes en la columna del extremo derecho?
  const candidatos = new Map();

  // Recolectar todas las posiciones candidatas
  function recolectar(patrones, requierePuntajeDerecho) {
    for (const patron of patrones) {
      for (let i = 0; i < lineas.length; i++) {
        const l = lineas[i];
        if (!patron.test(l)) continue;
        // Saltar si es parte del TOC
        const ventana = lineas.slice(i, i + 8);
        const tocCount = ventana.filter((l) => REGEX_TOC.test(l)).length;
        if (tocCount >= 3) continue;
        const puntajeDerecho = tieneTablaPuntajesCerca(lineas, i);
        if (requierePuntajeDerecho && !puntajeDerecho) continue;
        // Conservar la señal más fuerte si la posición ya estaba registrada
        candidatos.set(i, candidatos.get(i) || puntajeDerecho);
      }
    }
  }

  // Fase 1: desempate (con validación de tabla con puntajes a la derecha)
  recolectar(DESEMPATE_PATTERNS, true);
  // Fase 2: encabezados clásicos (con validación de tabla con puntajes a la derecha)
  recolectar(ENCABEZADOS_CRITERIOS, true);
  // Fase 3: encabezados clásicos SIN exigir puntajes a la derecha (último recurso)
  recolectar(ENCABEZADOS_CRITERIOS, false);

  // De-duplicar posiciones cercanas (±5 líneas), conservando la marca de
  // "puntaje en columna derecha" si alguna de las cercanas la tiene.
  const uniquePos = [];
  for (const [pos, derecho] of candidatos) {
    const cercano = uniquePos.find((u) => Math.abs(u.pos - pos) <= 5);
    if (cercano) {
      cercano.derecho = cercano.derecho || derecho;
    } else {
      uniquePos.push({ pos, derecho });
    }
  }

  // Filtro: si existe al menos una tabla con los puntajes en la columna del
  // extremo derecho, descartamos las demás (esa es la tabla de criterios real).
  // Solo si ninguna candidata la tiene caemos al resto como último recurso.
  const conDerecho = uniquePos.filter((u) => u.derecho);
  const finalistas = conDerecho.length ? conDerecho : uniquePos;

  // Extraer criterios de cada finalista (conservando su marca de columna derecha).
  const evaluados = [];
  for (const { pos, derecho } of finalistas) {
    const resultado = extraerCriteriosDeBloque(lineas, pos);
    if (resultado) evaluados.push({ resultado, derecho });
  }

  // Filtro extra: "cuadros de puntaje". Toda fila de encabezado que diga PUNTAJE
  // abre un cuadro; lo leemos con el lector tolerante a cortes de página. Pueden
  // existir varios cuadros y el formato variar; cada uno entra como candidato.
  const vistosPuntaje = new Set();
  for (let i = 0; i < lineas.length; i++) {
    if (!ENCABEZADOS_PUNTAJE.some((re) => re.test(lineas[i]))) continue;
    if ([...vistosPuntaje].some((p) => Math.abs(p - i) <= 3)) continue;
    vistosPuntaje.add(i);
    const resultado = extraerCuadroPuntaje(lineas, i);
    if (resultado) evaluados.push({ resultado, derecho: true });
  }

  // Cuadros entregados columna a columna (PUNTAJE primero, FACTOR después):
  // el emparejamiento por posición es señal fuerte.
  for (const resultado of extraerColumnasFactorPuntaje(lineas)) {
    evaluados.push({ resultado, derecho: true });
  }

  // Filtro principal: la tabla de criterios correcta SIEMPRE suma 100 puntos.
  // Solo aceptamos candidatas cuyo total sea 100 (±1 por redondeo). Como último
  // recurso admitimos la escala de 1000 (±10) que usan algunos pliegos. Si
  // ninguna candidata cuadra con un total esperado, no hay tabla confiable.
  const cerca = (objetivo, tol) =>
    evaluados.filter(
      (e) => Math.abs(e.resultado.puntajeTotal - objetivo) <= tol,
    );
  const elegibles = cerca(100, 1).length ? cerca(100, 1) : cerca(1000, 10);
  if (!elegibles.length) return null;

  // Entre las válidas, la mejor: más criterios y puntajes en la columna derecha.
  let mejor = null;
  let mejorScore = -Infinity;
  for (const { resultado, derecho } of elegibles) {
    const s = scoreCandidato(resultado, derecho);
    if (s > mejorScore) {
      mejorScore = s;
      mejor = resultado;
    }
  }

  return mejor;
}

export function extraerCriterios(md) {
  if (!md || typeof md !== "string") {
    return { criterios: [], puntajeTotal: 0 };
  }

  const lineas = md.split(/\r?\n/);
  const resultado = buscarMejorTabla(lineas);
  if (!resultado) return { criterios: [], puntajeTotal: 0 };

  // Los puntajes se devuelven tal como aparecen en el pliego (sin reescalar).
  return resultado;
}

export async function analizarPliego(idPortafolio) {
  const docs = await getDocumentosPorProceso(idPortafolio);
  const pliego = elegirPliego(docs);

  if (!pliego) {
    const hasPdfs = docs.some(esPdf);
    return {
      id_portafolio: idPortafolio,
      documento_analizado: null,
      metodo_extraccion: null,
      markdown_cacheado: false,
      criterios: [],
      puntaje_total: 0,
      advertencias: [
        hasPdfs
          ? "No se pudo identificar el pliego de condiciones definitivo entre los PDFs disponibles. Ningún documento coincide con las palabras clave esperadas (pliego, definitivo, condiciones, documento base)."
          : "No se encontraron PDFs en esta licitación.",
      ],
      analizado_en: new Date().toISOString(),
    };
  }

  const advertencias = [];
  let buffer;
  let md = "";
  let cacheado = false;
  let metodo = "pdf-parse → markdown";
  try {
    ({ buffer } = await obtenerPdfPliego(pliego));
    const r = await obtenerMarkdownPliego(pliego, buffer);
    md = r.md;
    cacheado = r.cacheado;
  } catch (e) {
    return {
      id_portafolio: idPortafolio,
      documento_analizado: pliego,
      metodo_extraccion: metodo,
      markdown_cacheado: false,
      criterios: [],
      puntaje_total: 0,
      advertencias: [`Error al procesar el PDF: ${e.message}`],
      analizado_en: new Date().toISOString(),
    };
  }

  let criterios = [];
  let puntajeTotal = 0;
  const esEscaneado = await esPdfEscaneado(buffer, md.trim().length).catch(
    () => md.trim().length < 500,
  );

  if (!esEscaneado) {
    // 1) Tablas vectoriales del PDF: los puntajes salen celda por celda,
    //    tal cual están en el cuadro del pliego.
    const deTabla = await extraerCriteriosDeTabla(buffer).catch((e) => {
      console.warn(`[pliego] getTable falló para ${pliego.id}: ${e.message}`);
      return null;
    });
    if (deTabla) {
      ({ criterios, puntajeTotal } = deTabla);
      metodo = "tabla del PDF (celdas vectoriales)";
    } else {
      // 2) Fallback: heurística sobre el texto plano
      ({ criterios, puntajeTotal } = extraerCriterios(md));
    }
    if (criterios.length === 0) {
      advertencias.push(
        "No se identificó sección de criterios de evaluación en el pliego.",
      );
    }
  } else {
    // PDF escaneado (las páginas son imágenes). Si el escáner incrustó una
    // capa de texto, intentar primero con ella (suele ser mejor que re-OCRear).
    const delTexto =
      md.trim().length >= 500
        ? extraerCriterios(md)
        : { criterios: [], puntajeTotal: 0 };
    if (delTexto.criterios.length > 0) {
      ({ criterios, puntajeTotal } = delTexto);
      metodo = "texto incrustado del escaneo";
      advertencias.push(
        "El PDF es un documento escaneado: se usó la capa de texto incrustada por el escáner.",
      );
    } else {
      // Sin texto utilizable: SOLO aquí se usa OCR.
      advertencias.push(
        "El PDF es un documento escaneado (imagen): se aplicó OCR para leer la tabla de criterios.",
      );
      metodo = "ocr (tesseract.js) → markdown";
      try {
        const r = await ocrAMarkdown(pliego, buffer);
        md = r.md;
        cacheado = r.cacheado;
        ({ criterios, puntajeTotal } = extraerCriterios(md));
        if (criterios.length === 0) {
          advertencias.push(
            "El OCR no encontró una tabla de criterios reconocible.",
          );
        }
      } catch (e) {
        advertencias.push(`Error durante el OCR: ${e.message}`);
      }
    }
  }

  return {
    id_portafolio: idPortafolio,
    documento_analizado: pliego,
    metodo_extraccion: metodo,
    markdown_cacheado: cacheado,
    criterios,
    puntaje_total: puntajeTotal,
    advertencias,
    analizado_en: new Date().toISOString(),
  };
}
