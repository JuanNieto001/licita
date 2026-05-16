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
const OPEN_PROCESS_WHERE =
  "estado_del_procedimiento='Publicado' " +
  "AND fase in(" +
  "'Presentación de oferta'," +
  "'Fase de ofertas'," +
  "'Presentación de observaciones'," +
  "'Manifestación de interés (Menor Cuantía)'," +
  "'Selección de ofertas (borrador)'," +
  "'Fase de Selección (Presentación de ofertas)'" +
  ")";

// Modalidades que tienen pliego de condiciones formal con Formato 1, 2, 3, anexos,
// experiencia, puntaje por emprendimiento de mujeres (Ley 2069/2020), etc.
export const MODALIDADES_CON_PLIEGO = [
  "Licitación pública",
  "Licitación pública Obra Publica",
  "Licitación Pública Acuerdo Marco de Precios",
  "Selección Abreviada de Menor Cuantía",
  "Selección abreviada subasta inversa",
  "Seleccion Abreviada Menor Cuantia Sin Manifestacion Interes",
  "Concurso de méritos abierto",
  "Concurso de méritos con precalificación",
  "Mínima cuantía",
];

function combineWhere(...clauses) {
  return clauses.filter(Boolean).map((c) => `(${c})`).join(" AND ");
}

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

const baseHeaders = APP_TOKEN ? { "X-App-Token": APP_TOKEN } : {};

async function socrataGet(url, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, v);
  }
  const full = `${url}?${qs.toString()}`;
  const cacheKey = full;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { statusCode, body } = await request(full, {
    headers: baseHeaders,
    headersTimeout: 30000,
    bodyTimeout: 60000,
  });
  if (statusCode < 200 || statusCode >= 300) {
    const text = await body.text();
    const err = new Error(`Socrata ${statusCode}: ${text.slice(0, 300)}`);
    err.statusCode = statusCode;
    throw err;
  }
  const json = await body.json();
  cache.set(cacheKey, json);
  return json;
}

function escapeSoql(value) {
  return String(value).replace(/'/g, "''");
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
  modalidad,
  soloConPliego,
  soloAbiertos = true,
  soloConDocumentos = false,
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
  if (modalidad) where.push(`modalidad_de_contratacion='${escapeSoql(modalidad)}'`);
  if (soloConPliego) {
    const list = MODALIDADES_CON_PLIEGO
      .map((m) => `'${escapeSoql(m)}'`)
      .join(",");
    where.push(`modalidad_de_contratacion in(${list})`);
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
    soloAbiertos ? OPEN_PROCESS_WHERE : "",
    userWhere,
  );

  if (!soloConDocumentos) {
    const params = {
      $limit: pageSize,
      $offset: offset,
      $order: `${sortCol} ${sortDir}`,
      $where: fullWhere,
    };
    const [items, countRes] = await Promise.all([
      socrataGet(PROCESOS, params),
      socrataGet(PROCESOS, {
        $select: "count(id_del_portafolio) as total",
        $where: fullWhere,
      }),
    ]);
    const total = Number(countRes?.[0]?.total ?? 0);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      filtroConDocumentos: false,
    };
  }

  // Modo "solo con documentos": sobre-muestreamos, cruzamos con el dataset de docs
  // y verificamos individualmente para eliminar falsos positivos.
  const FETCH_FACTOR = 25;
  const HARD_CAP = 2000;
  const candidatesNeeded = Math.min(HARD_CAP, page * pageSize * FETCH_FACTOR);
  const candidates = await socrataGet(PROCESOS, {
    $limit: candidatesNeeded,
    $offset: 0,
    $order: `${sortCol} ${sortDir}`,
    $where: fullWhere,
  });

  if (!candidates.length) {
    return { items: [], total: 0, page, pageSize, totalPages: 0, filtroConDocumentos: true };
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

  // 2. Cruce batch rápido con datasets de documentos (pre-filtro)
  const uniqueIds = uniqueCandidates.map((c) => c.id_del_portafolio);
  const CHUNK = 80;
  const conDocs = new Set();
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    const found = await getProcesosConDocs(chunk);
    for (const p of found) conDocs.add(p);
  }

  const batchFiltered = uniqueCandidates.filter((c) => conDocs.has(c.id_del_portafolio));

  // 3. Verificación individual: confirmar que cada candidato realmente tiene documentos.
  //    Esto elimina falsos positivos causados por caché o inconsistencias en la API SECOP.
  const verified = [];
  for (const candidate of batchFiltered) {
    const docs = await getDocumentosPorProceso(candidate.id_del_portafolio);
    if (docs.length > 0) {
      verified.push(candidate);
    }
  }

  const total = verified.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const items = verified.slice(startIdx, startIdx + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    filtroConDocumentos: true,
    aproximado: candidatesNeeded >= HARD_CAP,
  };
}

export async function getLicitacion(idPortafolio) {
  const res = await socrataGet(PROCESOS, {
    $where: `id_del_portafolio='${escapeSoql(idPortafolio)}'`,
    $limit: 1,
  });
  return res?.[0] || null;
}

export async function getDocumentosPorProceso(idPortafolio) {
  const id = escapeSoql(idPortafolio);
  const where = `proceso='${id}'`;
  const results = await Promise.all(
    DOC_DATASETS.map((url) =>
      socrataGet(url, { $where: where, $limit: 200 }).catch(() => []),
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

  const [estados, departamentos, modalidades] = await Promise.all([
    socrataGet(PROCESOS, {
      $select: "estado_del_procedimiento, count(*) as c",
      $where: INGENIERIA_CIVIL_WHERE,
      $group: "estado_del_procedimiento",
      $order: "c DESC",
      $limit: 50,
    }).catch(() => []),
    socrataGet(PROCESOS, {
      $select: "departamento_entidad, count(*) as c",
      $where: INGENIERIA_CIVIL_WHERE,
      $group: "departamento_entidad",
      $order: "c DESC",
      $limit: 50,
    }).catch(() => []),
    socrataGet(PROCESOS, {
      $select: "modalidad_de_contratacion, count(*) as c",
      $where: INGENIERIA_CIVIL_WHERE,
      $group: "modalidad_de_contratacion",
      $order: "c DESC",
      $limit: 50,
    }).catch(() => []),
  ]);
  const facets = {
    estados: estados.map((e) => e.estado_del_procedimiento).filter(Boolean),
    departamentos: departamentos.map((d) => d.departamento_entidad).filter(Boolean),
    modalidades: modalidades
      .map((m) => m.modalidad_de_contratacion)
      .filter(Boolean),
    modalidadesConPliego: MODALIDADES_CON_PLIEGO,
  };
  cache.set(cacheKey, facets, 3600);
  return facets;
}
