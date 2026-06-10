import { request } from "undici";
import NodeCache from "node-cache";

const SOCRATA_BASE = "https://www.datos.gov.co/resource";
const PROCESOS = `${SOCRATA_BASE}/p6dx-8zbt.json`;
const DOCS_2025 = `${SOCRATA_BASE}/dmgg-8hin.json`;
const DOCS_2023 = `${SOCRATA_BASE}/3skv-9na7.json`;
const DOCS_2022 = `${SOCRATA_BASE}/kgcd-kt7i.json`;
const DOCS_HASTA_2021 = `${SOCRATA_BASE}/f8va-cf4m.json`;

const DOC_DATASETS = [DOCS_2025, DOCS_2023, DOCS_2022, DOCS_HASTA_2021];

// Filtro UNSPSC + tipo de contrato para limitar a procesos de ingeniería civil:
// - Tipo de contrato "Obra" (obras civiles, casi siempre ingeniería civil)
// - Categoría UNSPSC V1.81101* (servicios profesionales de ingeniería civil/edificación)
// - Categoría UNSPSC V1.95* (estructuras y edificios)
// - Categoría UNSPSC V1.72* y tipo Consultoría/Interventoría (servicios de construcción)
const INGENIERIA_CIVIL_WHERE =
  "(" +
  "tipo_de_contrato='Obra' " +
  "OR starts_with(codigo_principal_de_categoria,'V1.81101') " +
  "OR starts_with(codigo_principal_de_categoria,'V1.95') " +
  "OR (tipo_de_contrato in('Consultoría','Interventoría') " +
  "AND (starts_with(codigo_principal_de_categoria,'V1.72') " +
  "OR starts_with(codigo_principal_de_categoria,'V1.81101') " +
  "OR starts_with(codigo_principal_de_categoria,'V1.95')))" +
  ")";

// Procesos actualmente abiertos y recibiendo ofertas: estado Publicado + fase activa.
// NO se incluyen las fases de borrador ('Presentación de observaciones',
// 'Selección de ofertas (borrador)'): en ellas no se pueden presentar ofertas y,
// cuando su plazo de observaciones vence (contador en cero en la página de SECOP),
// no hay forma de saberlo por los datos abiertos — el cronograma no está publicado.
const OPEN_PROCESS_WHERE =
  "estado_del_procedimiento='Publicado' " +
  "AND fase in(" +
  "'Presentación de oferta'," +
  "'Fase de ofertas'," +
  "'Manifestación de interés (Menor Cuantía)'," +
  "'Fase de Selección (Presentación de ofertas)'" +
  ")";

// Solo licitaciones públicas (LP)
const LP_MODALIDADES = [
  "Licitación pública",
  "Licitación pública Obra Publica",
  "Licitación Pública Acuerdo Marco de Precios",
];

const LP_WHERE =
  "(" +
  LP_MODALIDADES.map((m) => `modalidad_de_contratacion='${m}'`).join(" OR ") +
  ")";

function combineWhere(...clauses) {
  return clauses.filter(Boolean).map((c) => `(${c})`).join(" AND ");
}

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

const baseHeaders = APP_TOKEN ? { "X-App-Token": APP_TOKEN } : {};

function esErrorTransitorio(e) {
  if (!e) return false;
  if (e.transitorio) return true;
  const code = e.code || "";
  return (
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    e.name === "AbortError" ||
    /timeout|aborted|socket/i.test(e.message || "")
  );
}

// datos.gov.co es lento y devuelve timeouts intermitentes. Reintentamos los
// fallos transitorios para no perder resultados (p.ej. documentos de un proceso).
async function socrataGet(url, params = {}, { maxIntentos = 3 } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, v);
  }
  const full = `${url}?${qs.toString()}`;
  const cached = cache.get(full);
  if (cached) return cached;

  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const { statusCode, body } = await request(full, {
        headers: baseHeaders,
        headersTimeout: 30000,
        bodyTimeout: 60000,
      });
      if (statusCode >= 500 || statusCode === 429) {
        await body.text().catch(() => {});
        throw Object.assign(new Error(`Socrata ${statusCode} (transitorio)`), {
          statusCode,
          transitorio: true,
        });
      }
      if (statusCode < 200 || statusCode >= 300) {
        const text = await body.text();
        throw Object.assign(new Error(`Socrata ${statusCode}: ${text.slice(0, 300)}`), {
          statusCode,
        });
      }
      const json = await body.json();
      cache.set(full, json);
      return json;
    } catch (e) {
      ultimoError = e;
      if (!esErrorTransitorio(e) || intento === maxIntentos) throw e;
      await new Promise((r) => setTimeout(r, 400 * intento));
    }
  }
  throw ultimoError;
}

function escapeSoql(value) {
  return String(value).replace(/'/g, "''");
}

// Fechas de SECOP en texto: "16/06/2026 12:00:00 a. m." (hora de Colombia, UTC-5)
function parseFechaSecop(s) {
  if (!s) return null;
  const m = String(s)
    .trim()
    .match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?)?/i,
    );
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [, dd, MM, yyyy, hh, mm, ss, ap] = m;
  let h = Number(hh || 0);
  if (ap) {
    const esPm = ap.toLowerCase() === "p";
    if (esPm && h !== 12) h += 12;
    if (!esPm && h === 12) h = 0;
  }
  return new Date(
    Date.UTC(Number(yyyy), Number(MM) - 1, Number(dd), h + 5, Number(mm || 0), Number(ss || 0)),
  );
}

/**
 * El contador de la página oficial de SECOP (div#ctdCountdown) cuenta hacia la
 * fecha de recepción de ofertas. Si esa fecha ya pasó, el contador está en cero
 * y ya no se puede participar en el proceso.
 */
export function plazoVencido(lic) {
  const fin = parseFechaSecop(lic?.fecha_de_recepcion_de);
  if (!fin) return false; // sin fecha no se puede saber → no excluir
  return fin.getTime() <= Date.now();
}

// Fecha de cierre normalizada (epoch ms) para que el frontend pueda mostrar
// la cuenta regresiva en tiempo real sin lidiar con los formatos de SECOP.
export function fechaCierreMs(lic) {
  const fin = parseFechaSecop(lic?.fecha_de_recepcion_de);
  return fin ? fin.getTime() : null;
}

async function getProcesosConDocs(procesoIds) {
  if (!procesoIds.length) return new Set();
  const cacheKey = `docsexists:${procesoIds.slice().sort().join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const inList = procesoIds.map((p) => `'${escapeSoql(p)}'`).join(",");
  const where = `proceso in(${inList})`;

  const results = await Promise.all(
    DOC_DATASETS.map((url) =>
      socrataGet(url, { $select: "proceso", $where: where, $group: "proceso", $limit: procesoIds.length }).catch(
        () => [],
      ),
    ),
  );
  const set = new Set();
  for (const arr of results) {
    for (const row of arr) {
      if (row.proceso) set.add(row.proceso);
    }
  }
  cache.set(cacheKey, set, 600);
  return set;
}

export async function listLicitaciones({
  page = 1,
  pageSize = 20,
  search,
  entidad,
  departamento,
  estado,
  soloAbiertos = true,
  fechaDesde,
  fechaHasta,
  presupuestoMin,
  presupuestoMax,
  ordenarPor = "fecha_de_publicacion_del",
  orden = "DESC",
} = {}) {
  const offset = (page - 1) * pageSize;
  const where = [];

  if (search) {
    const s = escapeSoql(search.toUpperCase());
    where.push(
      `(upper(nombre_del_procedimiento) like '%${s}%' OR upper(descripci_n_del_procedimiento) like '%${s}%' OR upper(entidad) like '%${s}%' OR upper(referencia_del_proceso) like '%${s}%')`,
    );
  }
  if (entidad) where.push(`upper(entidad) like '%${escapeSoql(entidad.toUpperCase())}%'`);
  if (departamento) where.push(`departamento_entidad='${escapeSoql(departamento)}'`);
  if (!soloAbiertos && estado) {
    where.push(`estado_del_procedimiento='${escapeSoql(estado)}'`);
  }
  if (fechaDesde) where.push(`fecha_de_publicacion_del >= '${escapeSoql(fechaDesde)}T00:00:00.000'`);
  if (fechaHasta) where.push(`fecha_de_publicacion_del <= '${escapeSoql(fechaHasta)}T23:59:59.999'`);
  if (presupuestoMin) where.push(`precio_base >= ${Number(presupuestoMin)}`);
  if (presupuestoMax) where.push(`precio_base <= ${Number(presupuestoMax)}`);

  const allowedOrder = new Set([
    "fecha_de_publicacion_del",
    "precio_base",
    "entidad",
    "estado_del_procedimiento",
  ]);
  const sortCol = allowedOrder.has(ordenarPor) ? ordenarPor : "fecha_de_publicacion_del";
  const sortDir = orden === "ASC" ? "ASC" : "DESC";

  const userWhere = where.length ? where.join(" AND ") : "";
  const fullWhere = combineWhere(
    INGENIERIA_CIVIL_WHERE,
    LP_WHERE,
    soloAbiertos ? OPEN_PROCESS_WHERE : "",
    userWhere,
  );

  // Siempre filtrar por licitaciones que tienen documentos descargables.
  // Muestreamos un universo grande para alcanzar procesos más antiguos
  // que sí tengan documentos publicados (retraso SECOP ~2 meses).
  const HARD_CAP = 2000;
  const candidates = await socrataGet(PROCESOS, {
    $limit: HARD_CAP,
    $offset: 0,
    $order: `${sortCol} ${sortDir}`,
    $where: fullWhere,
  });

  if (!candidates.length) {
    return { items: [], total: 0, page, pageSize, totalPages: 0 };
  }

  // 1. De-duplicar candidatos (SECOP puede devolver el mismo ID varias veces)
  const seenIds = new Set();
  const uniqueCandidates = [];
  for (const c of candidates) {
    if (c.id_del_portafolio && !seenIds.has(c.id_del_portafolio)) {
      seenIds.add(c.id_del_portafolio);
      uniqueCandidates.push(c);
    }
  }

  // 1b. Excluir procesos cuyo plazo de recepción de ofertas ya venció
  //     (contador en cero en la página de SECOP → ya no se puede participar).
  const vigentes = uniqueCandidates.filter((c) => !plazoVencido(c));

  // 2. Cruce batch PARALELO con datasets de documentos
  //    Chunks se procesan todos a la vez en lugar de secuencialmente.
  const uniqueIds = vigentes.map((c) => c.id_del_portafolio);
  const CHUNK = 150;
  const chunks = [];
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    chunks.push(uniqueIds.slice(i, i + CHUNK));
  }
  const chunkResults = await Promise.all(
    chunks.map((chunk) => getProcesosConDocs(chunk)),
  );
  const conDocs = new Set();
  for (const found of chunkResults) {
    for (const p of found) conDocs.add(p);
  }

  const batchFiltered = vigentes.filter((c) => conDocs.has(c.id_del_portafolio));

  const total = batchFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const items = batchFiltered
    .slice(startIdx, startIdx + pageSize)
    .map((it) => ({ ...it, cierre_epoch_ms: fechaCierreMs(it) }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    aproximado: uniqueCandidates.length >= HARD_CAP,
  };
}

export async function getLicitacion(idPortafolio) {
  const res = await socrataGet(PROCESOS, {
    $where: `id_del_portafolio='${escapeSoql(idPortafolio)}'`,
    $limit: 1,
  });
  const lic = res?.[0] || null;
  return lic ? { ...lic, cierre_epoch_ms: fechaCierreMs(lic) } : null;
}

export async function getDocumentosPorProceso(idPortafolio) {
  const id = escapeSoql(idPortafolio);
  const where = `proceso='${id}'`;
  // $limit alto: algunos procesos grandes superan los 200 documentos (planos,
  // anexos, adendas). Cada dataset se consulta con reintentos; si uno falla de
  // forma definitiva lo registramos en vez de descartarlo en silencio.
  const results = await Promise.all(
    DOC_DATASETS.map((url) =>
      socrataGet(url, { $where: where, $limit: 1000 }).catch((e) => {
        console.warn(`[docs] dataset ${url} falló para ${idPortafolio}: ${e.message}`);
        return [];
      }),
    ),
  );
  const flat = results.flat();
  const seen = new Set();
  const unique = [];
  for (const d of flat) {
    if (!d?.id_documento || seen.has(d.id_documento)) continue;
    seen.add(d.id_documento);
    unique.push(d);
  }
  return unique;
}

export async function getDocumentoMeta(idDocumento) {
  const id = escapeSoql(idDocumento);
  for (const ds of DOC_DATASETS) {
    const res = await socrataGet(ds, {
      $where: `id_documento='${id}'`,
      $limit: 1,
    }).catch(() => []);
    if (res?.[0]) return res[0];
  }
  return null;
}

export async function getFacets() {
  const cacheKey = "__facets__";
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const baseWhere = combineWhere(INGENIERIA_CIVIL_WHERE, LP_WHERE);

  const [estados, departamentos] = await Promise.all([
    socrataGet(PROCESOS, {
      $select: "estado_del_procedimiento, count(*) as c",
      $where: baseWhere,
      $group: "estado_del_procedimiento",
      $order: "c DESC",
      $limit: 50,
    }).catch(() => []),
    socrataGet(PROCESOS, {
      $select: "departamento_entidad, count(*) as c",
      $where: baseWhere,
      $group: "departamento_entidad",
      $order: "c DESC",
      $limit: 50,
    }).catch(() => []),
  ]);
  const facets = {
    estados: estados.map((e) => e.estado_del_procedimiento).filter(Boolean),
    departamentos: departamentos.map((d) => d.departamento_entidad).filter(Boolean),
  };
  cache.set(cacheKey, facets, 3600);
  return facets;
}
