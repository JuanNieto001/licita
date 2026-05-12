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

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const SECOP_DOC_BASE =
  "https://community.secop.gov.co/Public/Archive/RetrieveFile/Index";

function buildDocUrl(documentId) {
  return `${SECOP_DOC_BASE}?DocumentId=${encodeURIComponent(documentId)}&InCommunity=False&InPaymentGateway=False&DocUniqueIdentifier=`;
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
      modalidad,
      soloConPliego,
      soloAbiertos = "1",
      soloConDocumentos,
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
      modalidad,
      soloConPliego: soloConPliego === "1" || soloConPliego === "true",
      soloAbiertos: soloAbiertos === "1" || soloAbiertos === "true",
      fechaDesde,
      fechaHasta,
      presupuestoMin,
      presupuestoMax,
      ordenarPor,
      orden,
    });
    res.json(result);
  }),
);

app.get(
  "/api/licitaciones/:idPortafolio",
  asyncHandler(async (req, res) => {
    const lic = await getLicitacion(req.params.idPortafolio);
    if (!lic) return res.status(404).json({ error: "Licitación no encontrada" });
    res.json(lic);
  }),
);

app.get(
  "/api/licitaciones/:idPortafolio/documentos",
  asyncHandler(async (req, res) => {
    const docs = await getDocumentosPorProceso(req.params.idPortafolio);
    res.json(docs);
  }),
);

app.get(
  "/api/documentos/:id/descargar",
  asyncHandler(async (req, res) => {
    const docId = req.params.id;
    const meta = await getDocumentoMeta(docId);
    const filename = sanitizeFilename(
      meta?.nombre_archivo || `documento_${docId}.bin`,
    );
    const url = buildDocUrl(docId);

    const upstream = await downloadFromSecop(url);

    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      const text = await upstream.body.text();
      return res.status(upstream.statusCode).json({
        error: "No se pudo descargar el documento desde SECOP II",
        details: text.slice(0, 300),
      });
    }

    const ct = upstream.headers["content-type"] || "application/octet-stream";
    const cl = upstream.headers["content-length"];
    res.setHeader("Content-Type", ct);
    if (cl) res.setHeader("Content-Length", cl);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    upstream.body.pipe(res);
    upstream.body.on("error", (err) => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
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
      let name = sanitizeFilename(d.nombre_archivo || `${d.id_documento}.bin`);
      if (used.has(name.toLowerCase())) {
        const dot = name.lastIndexOf(".");
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        name = `${base}_${d.id_documento}${ext}`;
      }
      used.add(name.toLowerCase());

      try {
        const upstream = await downloadFromSecop(url);
        if (upstream.statusCode >= 200 && upstream.statusCode < 300) {
          archive.append(upstream.body, { name });
          await new Promise((resolve, reject) => {
            upstream.body.on("end", resolve);
            upstream.body.on("error", reject);
          });
        } else {
          archive.append(
            `No se pudo descargar (HTTP ${upstream.statusCode})\nURL: ${url}\n`,
            { name: `ERROR_${name}.txt` },
          );
        }
      } catch (err) {
        archive.append(`Error al descargar: ${err.message}\nURL: ${url}\n`, {
          name: `ERROR_${name}.txt`,
        });
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
