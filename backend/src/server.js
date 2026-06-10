import express from "express";
import cors from "cors";
import archiver from "archiver";
import { request, Agent, interceptors } from "undici";
import {
  listLicitaciones,
  getLicitacion,
  getDocumentosPorProceso,
  getDocumentoMeta,
  getFacets,
} from "./socrata.js";
import * as db from "./db.js";
import { analizarPliego, setDownloader } from "./pdfAnalyzer.js";

const downloadDispatcher = new Agent().compose(
  interceptors.redirect({ maxRedirections: 5 }),
);

async function downloadFromSecop(url) {
  return request(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SECOP-Viewer",
    },
    headersTimeout: 30000,
    bodyTimeout: 180000,
    dispatcher: downloadDispatcher,
  });
}

setDownloader(downloadFromSecop);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const SECOP_DOC_BASE =
  "https://community.secop.gov.co/Public/Archive/RetrieveFile/Index";

function buildDocUrl(documentId) {
  return `${SECOP_DOC_BASE}?DocumentId=${encodeURIComponent(documentId)}&InCommunity=False&InPaymentGateway=False&DocUniqueIdentifier=`;
}

// SECOP devuelve Content-Type "application/unknown" para casi todo. Mapeamos el
// tipo real por extensión para que el navegador/Windows reconozcan el archivo.
const MIME_POR_EXT = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  rar: "application/vnd.rar",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

function extDe(nombre, fallbackExt) {
  const m = /\.([a-z0-9]{2,5})$/i.exec((nombre || "").trim());
  return (m ? m[1] : fallbackExt || "").toLowerCase();
}

function nombreConExtension(nombre, ext) {
  const limpio = (nombre || "").trim();
  if (!limpio) return `documento.${ext || "bin"}`;
  if (ext && !new RegExp(`\\.${ext}$`, "i").test(limpio)) return `${limpio}.${ext}`;
  return limpio;
}

function tipoContenido(ext, ctUpstream) {
  if (MIME_POR_EXT[ext]) return MIME_POR_EXT[ext];
  if (ctUpstream && ctUpstream !== "application/unknown") return ctUpstream;
  return "application/octet-stream";
}

// Descarga el documento COMPLETO a un buffer, con reintentos. Garantiza
// integridad: devuelve el archivo entero o un fallo claro, nunca un archivo
// truncado (causa de DOCX "corruptos que no abren": un ZIP truncado es ilegible).
async function descargarDocABuffer(url, maxIntentos = 3) {
  let ultimo;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const up = await downloadFromSecop(url);
      if (up.statusCode < 200 || up.statusCode >= 300) {
        const detalle = (await up.body.text().catch(() => "")).slice(0, 300);
        if ((up.statusCode >= 500 || up.statusCode === 429) && intento < maxIntentos) {
          await new Promise((r) => setTimeout(r, 500 * intento));
          continue;
        }
        return { ok: false, statusCode: up.statusCode, detalle };
      }
      const chunks = [];
      for await (const c of up.body) chunks.push(c);
      const buffer = Buffer.concat(chunks);
      const declarado = Number(up.headers["content-length"]);
      if (Number.isFinite(declarado) && declarado > 0 && buffer.length < declarado) {
        // Respuesta truncada: reintentar antes de entregar algo incompleto.
        if (intento < maxIntentos) {
          await new Promise((r) => setTimeout(r, 500 * intento));
          continue;
        }
        return {
          ok: false,
          statusCode: 502,
          detalle: `Descarga incompleta (${buffer.length}/${declarado} bytes)`,
        };
      }
      return { ok: true, statusCode: up.statusCode, buffer, headers: up.headers };
    } catch (e) {
      ultimo = e;
      if (intento < maxIntentos) {
        await new Promise((r) => setTimeout(r, 500 * intento));
        continue;
      }
    }
  }
  return { ok: false, statusCode: 502, detalle: ultimo?.message || "Error de red" };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function sanitizeFilename(name) {
  if (!name) return "documento";
  return name.replace(/[^\w\d\-._() ]+/g, "_").slice(0, 200);
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get(
  "/api/facets",
  asyncHandler(async (req, res) => {
    const facets = await getFacets();
    res.json(facets);
  }),
);

app.get(
  "/api/licitaciones",
  asyncHandler(async (req, res) => {
    const {
      page = "1",
      pageSize = "20",
      search,
      entidad,
      departamento,
      estado,
      soloAbiertos = "1",
      fechaDesde,
      fechaHasta,
      presupuestoMin,
      presupuestoMax,
      ordenarPor,
      orden,
    } = req.query;

    const result = await listLicitaciones({
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      search,
      entidad,
      departamento,
      estado,
      soloAbiertos: soloAbiertos === "1" || soloAbiertos === "true",
      fechaDesde,
      fechaHasta,
      presupuestoMin,
      presupuestoMax,
      ordenarPor,
      orden,
    });
    db.upsertManyLicitaciones(result.items);
    // Si el usuario fijó la hora exacta de cierre (la de la página de SECOP),
    // reemplaza la fecha truncada a medianoche que traen los datos abiertos.
    result.items = result.items.map((it) => {
      const exacto = db.getCierreExacto(it.id_del_portafolio);
      return exacto
        ? { ...it, cierre_epoch_ms: exacto, cierre_exacto: true }
        : { ...it, cierre_exacto: false };
    });
    res.json(result);
  }),
);

app.get(
  "/api/licitaciones/:idPortafolio",
  asyncHandler(async (req, res) => {
    const lic = await getLicitacion(req.params.idPortafolio);
    if (!lic) return res.status(404).json({ error: "Licitación no encontrada" });
    db.upsertLicitacion(lic);
    const exacto = db.getCierreExacto(lic.id_del_portafolio);
    res.json(
      exacto
        ? { ...lic, cierre_epoch_ms: exacto, cierre_exacto: true }
        : { ...lic, cierre_exacto: false },
    );
  }),
);

app.put(
  "/api/licitaciones/:idPortafolio/cierre-exacto",
  asyncHandler(async (req, res) => {
    const ms = Number(req.body?.cierre_ms);
    if (!Number.isFinite(ms) || ms <= 0) {
      return res.status(400).json({ error: "cierre_ms inválido" });
    }
    db.setCierreExacto(req.params.idPortafolio, ms);
    res.json({ ok: true, cierre_epoch_ms: ms, cierre_exacto: true });
  }),
);

app.delete(
  "/api/licitaciones/:idPortafolio/cierre-exacto",
  asyncHandler(async (req, res) => {
    db.setCierreExacto(req.params.idPortafolio, null);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/licitaciones/:idPortafolio/documentos",
  asyncHandler(async (req, res) => {
    const docs = await getDocumentosPorProceso(req.params.idPortafolio);
    db.setPdfs(req.params.idPortafolio, docs);
    res.json(docs);
  }),
);

app.get(
  "/api/licitaciones/:idPortafolio/analisis-pliego",
  asyncHandler(async (req, res) => {
    const id = req.params.idPortafolio;
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    if (!refresh) {
      const cached = db.getAnalisisPliego(id);
      // Solo reutilizar análisis exitosos: los fallidos (sin documento
      // identificado) se reintentan, p.ej. tras mejorar las palabras clave.
      if (cached?.documento_analizado) {
        return res.json({ ...cached, desde_cache: true });
      }
    }

    const analisis = await analizarPliego(id);
    db.setAnalisisPliego(id, analisis);
    res.json(analisis);
  }),
);

// ===== Base de datos local =====
app.get(
  "/api/db/stats",
  asyncHandler(async (req, res) => {
    res.json(db.stats());
  }),
);

app.get(
  "/api/db/licitaciones",
  asyncHandler(async (req, res) => {
    const {
      page = "1",
      pageSize = "12",
      search,
      tienePdfs,
    } = req.query;
    res.json(
      db.listSaved({
        page: Math.max(1, parseInt(page, 10) || 1),
        pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 12)),
        search,
        tienePdfs,
      }),
    );
  }),
);

app.get(
  "/api/db/licitaciones/:id",
  asyncHandler(async (req, res) => {
    const it = db.getSaved(req.params.id);
    if (!it) return res.status(404).json({ error: "No está en la base local" });
    res.json(it);
  }),
);

app.delete(
  "/api/db/licitaciones/:id",
  asyncHandler(async (req, res) => {
    const ok = db.removeSaved(req.params.id);
    res.json({ ok });
  }),
);

app.delete(
  "/api/db",
  asyncHandler(async (req, res) => {
    db.clearAll();
    res.json({ ok: true });
  }),
);

// Sincroniza la presencia de PDFs para un grupo de licitaciones (max 30 por llamada).
app.post(
  "/api/db/sync-pdfs",
  asyncHandler(async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids))
      return res.status(400).json({ error: "Se requiere body { ids: [...] }" });
    const slice = ids.slice(0, 30);
    let processed = 0;
    let conPdfs = 0;
    for (const id of slice) {
      try {
        const docs = await getDocumentosPorProceso(id);
        db.setPdfs(id, docs);
        if (docs.length > 0) conPdfs++;
        processed++;
      } catch (e) {
        // sigue con el siguiente
      }
    }
    res.json({ ok: true, processed, conPdfs, total: ids.length });
  }),
);

app.get(
  "/api/documentos/:id/descargar",
  asyncHandler(async (req, res) => {
    const docId = req.params.id;
    const meta = await getDocumentoMeta(docId).catch(() => null);
    const ext = extDe(meta?.nombre_archivo, meta?.extensi_n);
    const filename = sanitizeFilename(
      nombreConExtension(meta?.nombre_archivo, ext) || `documento_${docId}.bin`,
    );
    const url = buildDocUrl(docId);

    const r = await descargarDocABuffer(url);
    if (!r.ok) {
      return res.status(r.statusCode || 502).json({
        error: "No se pudo descargar el documento desde SECOP II",
        details: r.detalle,
      });
    }

    res.setHeader("Content-Type", tipoContenido(ext, r.headers["content-type"]));
    res.setHeader("Content-Length", r.buffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(r.buffer);
  }),
);

app.get(
  "/api/licitaciones/:idPortafolio/zip",
  asyncHandler(async (req, res) => {
    const idPortafolio = req.params.idPortafolio;
    const docs = await getDocumentosPorProceso(idPortafolio);
    if (!docs.length)
      return res.status(404).json({ error: "Sin documentos asociados" });

    const zipName = sanitizeFilename(`${idPortafolio}_documentos.zip`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    });
    archive.pipe(res);

    const used = new Set();
    for (const d of docs) {
      const url = buildDocUrl(d.id_documento);
      const ext = extDe(d.nombre_archivo, d.extensi_n);
      let name = sanitizeFilename(
        nombreConExtension(d.nombre_archivo, ext) || `${d.id_documento}.bin`,
      );
      if (used.has(name.toLowerCase())) {
        const dot = name.lastIndexOf(".");
        const baseN = dot > 0 ? name.slice(0, dot) : name;
        const extN = dot > 0 ? name.slice(dot) : "";
        name = `${baseN}_${d.id_documento}${extN}`;
      }
      used.add(name.toLowerCase());

      // Descargamos a buffer (completo o nada) antes de añadir al ZIP: así una
      // descarga truncada nunca se cuela como entrada corrupta.
      const r = await descargarDocABuffer(url);
      if (r.ok) {
        archive.append(r.buffer, { name });
      } else {
        archive.append(
          `No se pudo descargar (HTTP ${r.statusCode})\n${r.detalle || ""}\nURL: ${url}\n`,
          { name: `ERROR_${name}.txt` },
        );
      }
    }

    await archive.finalize();
  }),
);

app.use((err, req, res, next) => {
  console.error("[error]", err);
  if (res.headersSent) return next(err);
  res
    .status(err.statusCode || 500)
    .json({ error: err.message || "Error interno" });
});

app.listen(PORT, () => {
  console.log(`SECOP backend listening on http://localhost:${PORT}`);
});
