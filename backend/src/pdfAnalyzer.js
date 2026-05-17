import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";
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

export function elegirPliego(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const pdfs = docs.filter((d) => (d?.extensi_n || "").toLowerCase() === "pdf");
  if (!pdfs.length) return null;

  const score = (d) => {
    const n = nombreNormalizado(d);
    let s = 0;
    if (n.includes("pliego")) s += 10;
    if (n.includes("condiciones")) s += 6;
    if (n.includes("definitivo")) s += 8;
    if (n.includes("proyecto")) s += 2;
    if (n.includes("adenda")) s -= 12;
    if (n.includes("respuesta")) s -= 8;
    if (n.includes("observa")) s -= 6;
    if (n.includes("anexo")) s -= 4;
    return s;
  };

  const ranked = [...pdfs].sort((a, b) => {
    const sb = score(b);
    const sa = score(a);
    if (sb !== sa) return sb - sa;
    return (Number(b.tamanno_archivo) || 0) - (Number(a.tamanno_archivo) || 0);
  });

  const top = ranked[0];
  if (score(top) <= 0) {
    const porTamano = [...pdfs].sort(
      (a, b) =>
        (Number(b.tamanno_archivo) || 0) - (Number(a.tamanno_archivo) || 0),
    )[0];
    return {
      id: porTamano.id_documento,
      nombre: porTamano.nombre_archivo,
      tamano: Number(porTamano.tamanno_archivo) || 0,
    };
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

async function obtenerMarkdownPliego(doc) {
  fs.mkdirSync(PLIEGOS_DIR, { recursive: true });
  const mdPath = path.join(PLIEGOS_DIR, `${doc.id}.md`);

  if (fs.existsSync(mdPath)) {
    return { md: fs.readFileSync(mdPath, "utf8"), cacheado: true, mdPath };
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

  const md = await pdfAMarkdown(buffer);
  fs.writeFileSync(mdPath, md, "utf8");
  return { md, cacheado: false, mdPath };
}

const ENCABEZADOS_CRITERIOS = [
  /factores?\s+de\s+evaluaci[oó]n/i,
  /criterios?\s+de\s+evaluaci[oó]n/i,
  /criterios?\s+de\s+ponderaci[oó]n/i,
  /criterios?\s+de\s+calificaci[oó]n/i,
  /evaluaci[oó]n\s+y\s+calificaci[oó]n/i,
  /asignaci[oó]n\s+de\s+puntaje/i,
  /puntajes?\s+a\s+asignar/i,
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
  /\bp[áa]gina\s+\d+\s+de\s+\d+/i,
  /\bversi[óo]n\s+\d+/i,
  /\bc[óo]digo\s+[A-Z]/i,
  /\bNIT\b/i,
  /\bcra?\.?\s+\d+/i,
  /\bcalle\s+\d+/i,
  /\btel[ée]fono|\btel[.:]\s*\(?\d/i,
  /^no\.?\s+\d+\s*$/i,
];

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

function encontrarBloqueCriterios(lineas) {
  const headerHits = [];
  const proseHits = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (!ENCABEZADOS_CRITERIOS.some((re) => re.test(l))) continue;
    if (/^#{1,6}\s/.test(l)) headerHits.push(i);
    else proseHits.push(i);
  }

  for (const idx of headerHits) {
    const ventana = lineas.slice(idx, idx + 8);
    const tocCount = ventana.filter((l) => REGEX_TOC.test(l)).length;
    if (tocCount < 3) return idx;
  }
  if (headerHits.length > 0) return headerHits[headerHits.length - 1];

  for (const idx of proseHits) {
    const ventana = lineas.slice(idx, idx + 8);
    const tocCount = ventana.filter((l) => REGEX_TOC.test(l)).length;
    if (tocCount < 3) return idx;
  }
  return proseHits.length > 0 ? proseHits[0] : null;
}

export function extraerCriterios(md) {
  if (!md || typeof md !== "string") {
    return { criterios: [], puntajeTotal: 0 };
  }

  const lineas = md.split(/\r?\n/);
  const inicio = encontrarBloqueCriterios(lineas);
  if (inicio == null) return { criterios: [], puntajeTotal: 0 };

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
      re: /^(.+?)(?::\s*|\s+[\-–]\s*)(\d{1,4}(?:[.,]\d{1,3})?)\s*(puntos|pts|%)?\s*$/i,
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
      const nombre = limpiarNombreCriterio(m[1]);
      const puntaje = parsearNumero(m[2]);
      if (!nombre || nombre.length < 3 || nombre.length > 140) break;
      if (NOMBRES_EXCLUIDOS.has(nombre.toLowerCase())) break;
      if (/^\d/.test(nombre)) break;
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

    if (capturado) {
      lineasSinMatch = 0;
    } else if (criterios.length > 0) {
      lineasSinMatch++;
      if (lineasSinMatch >= 4) break;
    }
  }

  const puntajeTotal =
    Math.round(criterios.reduce((s, c) => s + c.puntaje, 0) * 100) / 100;
  return { criterios, puntajeTotal };
}

export async function analizarPliego(idPortafolio) {
  const docs = await getDocumentosPorProceso(idPortafolio);
  const pliego = elegirPliego(docs);

  if (!pliego) {
    return {
      id_portafolio: idPortafolio,
      documento_analizado: null,
      metodo_extraccion: null,
      markdown_cacheado: false,
      criterios: [],
      puntaje_total: 0,
      advertencias: ["No se encontraron PDFs en esta licitación"],
      analizado_en: new Date().toISOString(),
    };
  }

  const advertencias = [];
  let md = "";
  let cacheado = false;
  try {
    const r = await obtenerMarkdownPliego(pliego);
    md = r.md;
    cacheado = r.cacheado;
  } catch (e) {
    return {
      id_portafolio: idPortafolio,
      documento_analizado: pliego,
      metodo_extraccion: "pdf-parse → markdown",
      markdown_cacheado: false,
      criterios: [],
      puntaje_total: 0,
      advertencias: [`Error al procesar el PDF: ${e.message}`],
      analizado_en: new Date().toISOString(),
    };
  }

  if (md.trim().length < 500) {
    advertencias.push(
      "El PDF parece escaneado o sin capa de texto. No es posible analizarlo automáticamente.",
    );
  }

  const { criterios, puntajeTotal } = extraerCriterios(md);
  if (criterios.length === 0 && md.trim().length >= 500) {
    advertencias.push(
      "No se identificó sección de criterios de evaluación en el pliego.",
    );
  }

  return {
    id_portafolio: idPortafolio,
    documento_analizado: pliego,
    metodo_extraccion: "pdf-parse → markdown",
    markdown_cacheado: cacheado,
    criterios,
    puntaje_total: puntajeTotal,
    advertencias,
    analizado_en: new Date().toISOString(),
  };
}
