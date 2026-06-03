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
    // Palabras clave positivas — nombre completo y abreviaciones
    if (n.includes("pliego") || n.includes("plieg")) s += 12;
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
    .replace(/^#{1,6}\s*/, "") // marcador markdown de una fila en mayúsculas ("## FACTOR …")
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

// Quita el marcador markdown de encabezado ("## ", "### "…) para evaluar la línea
// como una posible fila de datos. pdfAMarkdown convierte toda línea EN MAYÚSCULAS
// en un encabezado `## …`; muchas tablas de puntaje vienen así ("## PROPUESTA
// ECONÓMICA 185"), y sin este destape se descartarían como simples encabezados.
function sinMarcadorMd(linea) {
  return linea.replace(/^#{1,6}\s+/, "");
}

// Remanente de encabezado de tabla: una línea compuesta ÚNICAMENTE por palabras de
// cabecera ("Concepto", "Factor", "Puntaje", "máximo", "Concepto Puntaje máximo"…).
// Importante: NO debe atrapar nombres reales que empiezan por una de esas palabras
// ("Factor de sostenibilidad técnico"), por eso exige que TODA la línea sean
// palabras de cabecera, no solo la primera.
function esRemanenteEncabezado(t) {
  return /^((concepto|factor|criterio|descripci[oó]n|[ií]tem|item|puntajes?|m[áa]xim[oa]|de|del|y)\s*)+$/i.test(
    t.trim(),
  );
}

// ¿La línea (en texto plano, sin marcador) sirve como continuación del nombre de
// una fila partida en dos? ("Vinculación de personas con" → "discapacidad 1").
// Exige letras, que no empiece por dígito, longitud razonable y que NO contenga un
// sub-puntaje entre paréntesis ("(155 PUNTOS)") ni sea un remanente de encabezado.
function esFragmentoNombre(texto) {
  const t = texto.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t)) return false;
  if (/^[\d.,]/.test(t)) return false;
  if (/\(\s*\d/.test(t)) return false; // sub-puntaje entre paréntesis → no es nombre
  if (esRemanenteEncabezado(t)) return false;
  return true;
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

    if (capturado) {
      lineasSinMatch = 0;
    } else if (criterios.length > 0) {
      lineasSinMatch++;
      if (lineasSinMatch >= 4) break;
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
  let modoMayusculas = false; // ¿la última fila capturada vino de una fila "## …"?

  for (let i = inicio + 1; i < fin; i++) {
    const original = lineas[i].trim();
    if (esEncabezadoSeccionNumerada(original)) break; // "## 4.1 …" nueva sección → fin
    if (REGEX_TOTAL_CUADRO.test(original)) break; // "Total 1000 puntos" → cierra el cuadro
    if (esRuidoDePagina(original)) {
      prefijo = ""; // un corte de página rompe la continuación de un nombre partido
      continue;
    }

    // Destapamos un eventual marcador "## " para leer filas en mayúsculas como
    // datos ("## PROPUESTA ECONÓMICA 185"). Si la fila ERA un encabezado markdown
    // NO puede actuar como fragmento de nombre (evita que "## DOCUMENTO BASE" o
    // "## CALIDAD" se peguen al siguiente criterio): los nombres partidos legítimos
    // de los pliegos tipo siempre vienen en texto plano (tienen minúsculas).
    const esHeader = /^#{1,6}\s+/.test(original);
    const linea = sinMarcadorMd(original);
    // La fila "Total" puede venir en mayúsculas → "## TOTAL: 100 PUNTOS"; hay que
    // detectarla SIN el marcador, o se capturaría como un criterio falso de 100.
    if (REGEX_TOTAL_CUADRO.test(linea)) break;

    const m = linea.match(/^(.+?)\s+(\d{1,4}(?:[.,]\d{1,3})?)\s*(puntos?|pts|%)?\.?\s*$/i);
    if (m) {
      const nombre = limpiarNombreCriterio((prefijo ? `${prefijo} ` : "") + m[1]);
      prefijo = "";
      const puntaje = parsearNumero(m[2]);
      const letras = (nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
      const valido =
        nombre &&
        nombre.length >= 3 &&
        nombre.length <= 200 &&
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
        modoMayusculas = esHeader;
        sinMatch = 0;
        continue;
      }
      // Matcheó número pero el nombre no es válido: no rompe el prefijo acumulado.
    }

    // Texto sin número: puede ser la primera parte de una fila partida en dos
    // ("Vinculación de personas con" → "discapacidad 1"). Las líneas en texto plano
    // siempre son candidatas; las líneas "## …" solo cuando ya venimos leyendo una
    // tabla EN MAYÚSCULAS (así "## PUNTAJE ADICIONAL… TRABAJADORES" + "## CON
    // DISCAPACIDAD 1" se unen, pero "## DOCUMENTO BASE" en un pliego tipo no).
    if ((!esHeader || modoMayusculas) && esFragmentoNombre(linea)) {
      prefijo = linea.trim();
    } else {
      prefijo = ""; // encabezado de página o ruido → no arrastrar nombre
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
 * Desempata entre tablas candidatas YA validadas (suman ~100, ver buscarMejorTabla).
 * Prefiere la que tiene más criterios y la que trae los puntajes en la columna del
 * extremo derecho.
 */
function scoreCandidato(resultado, puntajeDerecho = false) {
  if (!resultado || resultado.criterios.length === 0) return -Infinity;
  let score = resultado.criterios.length * 100; // más criterios = mejor
  if (puntajeDerecho) score += 5000; // puntajes en la columna del extremo derecho
  // Calidad de reconstrucción de nombres: cuando dos tablas suman lo mismo y tienen
  // el mismo número de criterios, preferimos la de nombres completos. Un nombre que
  // empieza en minúscula es señal de fila partida mal unida ("discapacidad",
  // "mujeres", "nacional", "agregado"); se penaliza. Los nombres más largos (mejor
  // reconstruidos) reciben un pequeño premio.
  for (const c of resultado.criterios) {
    if (/^[a-záéíóúñ]/.test(c.nombre)) score -= 60; // fragmento de fila partida
    score += Math.min(c.nombre.length, 60) * 0.2;
  }
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

  // Filtro principal por escala: la tabla de criterios correcta de un pliego tipo
  // SIEMPRE suma 100 puntos; algunos pliegos usan la escala de 1000.
  const cerca = (objetivo, tol) =>
    evaluados.filter(
      (e) => Math.abs(e.resultado.puntajeTotal - objetivo) <= tol,
    );

  // Nivel 1 (alta confianza): el total cuadra exactamente con la escala esperada.
  let elegibles = cerca(100, 1);
  let escala = 100;
  let sumaConfiable = true;
  if (!elegibles.length) {
    const mil = cerca(1000, 10);
    if (mil.length) {
      elegibles = mil;
      escala = 1000;
    }
  }

  // Nivel 2 (baja confianza): no hay total exacto, pero existe una tabla "casi
  // completa" (≥4 criterios, puntajes en la columna derecha) cuyo total queda
  // cerca de 100 ó 1000. En vez de descartar TODO —y mostrar "no se identificó
  // sección"— devolvemos la mejor aproximación marcada como no confiable, para
  // que el usuario sepa que puede faltar/sobrar un criterio y lo verifique.
  if (!elegibles.length) {
    const casi = (objetivo, tol) =>
      evaluados.filter(
        (e) =>
          e.derecho &&
          e.resultado.criterios.length >= 4 &&
          Math.abs(e.resultado.puntajeTotal - objetivo) <= tol,
      );
    const casi100 = casi(100, 12);
    const casi1000 = casi(1000, 80);
    if (casi100.length) {
      elegibles = casi100;
      escala = 100;
      sumaConfiable = false;
    } else if (casi1000.length) {
      elegibles = casi1000;
      escala = 1000;
      sumaConfiable = false;
    }
  }

  if (!elegibles.length) return null;

  // Entre las válidas, la mejor: más criterios, puntajes en la columna derecha y
  // nombres mejor reconstruidos (ver scoreCandidato).
  let mejor = null;
  let mejorScore = -Infinity;
  for (const { resultado, derecho } of elegibles) {
    const s = scoreCandidato(resultado, derecho);
    if (s > mejorScore) {
      mejorScore = s;
      mejor = resultado;
    }
  }

  return { ...mejor, sumaConfiable, escala };
}

export function extraerCriterios(md) {
  if (!md || typeof md !== "string") {
    return { criterios: [], puntajeTotal: 0 };
  }

  const lineas = md.split(/\r?\n/);
  const resultado = buscarMejorTabla(lineas);
  if (!resultado)
    return { criterios: [], puntajeTotal: 0, sumaConfiable: false, escala: null };

  // Los puntajes se devuelven tal como aparecen en el pliego (sin reescalar).
  return resultado;
}

export async function analizarPliego(idPortafolio) {
  const docs = await getDocumentosPorProceso(idPortafolio);
  const pliego = elegirPliego(docs);

  if (!pliego) {
    const hasPdfs = docs.some((d) => (d?.extensi_n || "").toLowerCase() === "pdf");
    return {
      id_portafolio: idPortafolio,
      documento_analizado: null,
      metodo_extraccion: null,
      markdown_cacheado: false,
      criterios: [],
      puntaje_total: 0,
      advertencias: [
        hasPdfs
          ? "No se pudo identificar el pliego de condiciones definitivo entre los PDFs disponibles. Ningún documento coincide con las palabras clave esperadas (pliego, definitivo, condiciones)."
          : "No se encontraron PDFs en esta licitación.",
      ],
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

  const { criterios, puntajeTotal, sumaConfiable, escala } = extraerCriterios(md);
  if (criterios.length === 0 && md.trim().length >= 500) {
    advertencias.push(
      "No se identificó sección de criterios de evaluación en el pliego.",
    );
  }
  if (criterios.length > 0 && sumaConfiable === false) {
    advertencias.push(
      `Los criterios identificados suman ${puntajeTotal} y no el total esperado (${escala || 100}). ` +
        "Es posible que falte o sobre un criterio, o que el pliego use otra distribución; " +
        "verifique el cuadro de puntajes directamente en el documento.",
    );
  }

  return {
    id_portafolio: idPortafolio,
    documento_analizado: pliego,
    metodo_extraccion: "pdf-parse → markdown",
    markdown_cacheado: cacheado,
    criterios,
    puntaje_total: puntajeTotal,
    suma_confiable: criterios.length > 0 ? sumaConfiable !== false : null,
    escala_puntaje: criterios.length > 0 ? escala || 100 : null,
    advertencias,
    analizado_en: new Date().toISOString(),
  };
}
