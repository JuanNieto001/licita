import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "licitaciones.json");

let data = {};
let writeTimer = null;
let dirty = false;

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf8");
      data = JSON.parse(raw);
      console.log(`[db] cargadas ${Object.keys(data).length} licitaciones`);
    }
  } catch (e) {
    console.error("[db] error al cargar:", e.message);
    data = {};
  }
}

function scheduleWrite() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      fs.mkdirSync(DB_DIR, { recursive: true });
      const tmp = DB_PATH + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, DB_PATH);
    } catch (e) {
      console.error("[db] error al escribir:", e.message);
      dirty = true;
    }
  }, 2000);
}

function buildDocUrl(documentId) {
  return `https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=${encodeURIComponent(
    documentId,
  )}&InCommunity=False&InPaymentGateway=False&DocUniqueIdentifier=`;
}

export function buildDictFromApi(apiItem) {
  if (!apiItem) return null;
  return {
    id: apiItem.id_del_portafolio,
    id_proceso: apiItem.id_del_proceso,
    referencia: apiItem.referencia_del_proceso,
    objeto: apiItem.nombre_del_procedimiento,
    descripcion: apiItem.descripci_n_del_procedimiento,
    entidad: apiItem.entidad,
    nit_entidad: apiItem.nit_entidad,
    departamento: apiItem.departamento_entidad,
    ciudad: apiItem.ciudad_entidad,
    orden_entidad: apiItem.ordenentidad,
    presupuesto: Number(apiItem.precio_base) || 0,
    estado: apiItem.estado_del_procedimiento,
    fase: apiItem.fase,
    modalidad: apiItem.modalidad_de_contratacion,
    tipo_contrato: apiItem.tipo_de_contrato,
    fecha_publicacion: apiItem.fecha_de_publicacion_del,
    fecha_ultima_publicacion: apiItem.fecha_de_ultima_publicaci,
    fecha_recepcion: apiItem.fecha_de_recepcion_de,
    fecha_apertura: apiItem.fecha_de_apertura_efectiva,
    duracion: apiItem.duracion,
    unidad_duracion: apiItem.unidad_de_duracion,
    url_proceso: apiItem.urlproceso?.url || apiItem.urlproceso || null,
    categoria_unspsc: apiItem.codigo_principal_de_categoria,
    adjudicado: apiItem.adjudicado === "Si",
    proveedor_adjudicado:
      apiItem.adjudicado === "Si" ? apiItem.nombre_del_proveedor : null,
    nit_proveedor:
      apiItem.adjudicado === "Si" ? apiItem.nit_del_proveedor_adjudicado : null,
    valor_adjudicado: Number(apiItem.valor_total_adjudicacion) || 0,
  };
}

export function upsertLicitacion(apiItem) {
  const id = apiItem?.id_del_portafolio;
  if (!id) return;
  const clean = buildDictFromApi(apiItem);
  const prev = data[id] || {};
  data[id] = {
    ...prev,
    ...clean,
    pdfs: prev.pdfs || [],
    tiene_pdfs: prev.tiene_pdfs ?? null,
    guardado_en: prev.guardado_en || new Date().toISOString(),
    actualizado_en: new Date().toISOString(),
  };
  scheduleWrite();
}

export function upsertManyLicitaciones(items) {
  for (const it of items) upsertLicitacion(it);
}

export function setPdfs(id, docs) {
  if (!id) return null;
  const prev = data[id] || { id };
  const pdfs = (docs || []).map((d) => ({
    id: d.id_documento,
    nombre: d.nombre_archivo,
    descripcion: d.descripci_n,
    extension: d.extensi_n,
    tamano: Number(d.tamanno_archivo) || 0,
    fecha_carga: d.fecha_carga,
    url_descarga:
      d.url_descarga_documento?.url || buildDocUrl(d.id_documento),
  }));
  data[id] = {
    ...prev,
    pdfs,
    tiene_pdfs: pdfs.length > 0,
    pdfs_verificados_en: new Date().toISOString(),
    actualizado_en: new Date().toISOString(),
  };
  scheduleWrite();
  return data[id];
}

export function getSaved(id) {
  return data[id] || null;
}

export function listSaved({ search, tienePdfs, page = 1, pageSize = 20 } = {}) {
  let items = Object.values(data);
  if (search) {
    const s = String(search).toLowerCase();
    items = items.filter(
      (l) =>
        (l.objeto || "").toLowerCase().includes(s) ||
        (l.entidad || "").toLowerCase().includes(s) ||
        (l.referencia || "").toLowerCase().includes(s),
    );
  }
  if (tienePdfs === "true" || tienePdfs === "1" || tienePdfs === "con") {
    items = items.filter((l) => l.tiene_pdfs === true);
  } else if (
    tienePdfs === "false" ||
    tienePdfs === "0" ||
    tienePdfs === "sin"
  ) {
    items = items.filter((l) => l.tiene_pdfs === false);
  } else if (tienePdfs === "unknown" || tienePdfs === "desconocido") {
    items = items.filter((l) => l.tiene_pdfs == null);
  }
  items.sort((a, b) =>
    (b.fecha_publicacion || "").localeCompare(a.fecha_publicacion || ""),
  );
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  return {
    items: items.slice(start, start + Number(pageSize)),
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.max(1, Math.ceil(total / Number(pageSize))),
  };
}

export function removeSaved(id) {
  if (data[id]) {
    delete data[id];
    scheduleWrite();
    return true;
  }
  return false;
}

export function clearAll() {
  data = {};
  scheduleWrite();
}

export function stats() {
  const all = Object.values(data);
  return {
    total: all.length,
    conPdfs: all.filter((l) => l.tiene_pdfs === true).length,
    sinPdfs: all.filter((l) => l.tiene_pdfs === false).length,
    sinVerificar: all.filter((l) => l.tiene_pdfs == null).length,
  };
}

export function getAllIds() {
  return Object.keys(data);
}

// Hora exacta de cierre fijada por el usuario (los datos abiertos solo traen
// el día; la hora está únicamente en la página de SECOP, tras captcha).
export function setCierreExacto(id, ms) {
  if (!id) return null;
  const prev = data[id] || { id };
  data[id] = {
    ...prev,
    cierre_exacto_ms: ms,
    actualizado_en: new Date().toISOString(),
  };
  scheduleWrite();
  return data[id];
}

export function getCierreExacto(id) {
  const v = data[id]?.cierre_exacto_ms;
  return Number.isFinite(v) ? v : null;
}

const ANALISIS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// Subir cuando cambie el algoritmo de extracción: invalida análisis viejos.
const ANALISIS_VERSION = 4;

export function getAnalisisPliego(id) {
  const item = data[id];
  if (!item?.analisis_pliego) return null;
  if (item.analisis_pliego.version !== ANALISIS_VERSION) return null;
  const ts = item.analisis_pliego.analizado_en;
  if (!ts) return item.analisis_pliego;
  const age = Date.now() - new Date(ts).getTime();
  if (age > ANALISIS_TTL_MS) return null;
  return item.analisis_pliego;
}

export function setAnalisisPliego(id, analisis) {
  if (!id) return null;
  const prev = data[id] || { id };
  data[id] = {
    ...prev,
    analisis_pliego: { ...analisis, version: ANALISIS_VERSION },
    actualizado_en: new Date().toISOString(),
  };
  scheduleWrite();
  return data[id];
}

load();
