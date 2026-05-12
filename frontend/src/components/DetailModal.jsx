import { useEffect, useState } from "react";
import { I } from "./Icons.jsx";
import {
  fetchDocumentos,
  urlDescargaDocumento,
  urlDescargaZip,
} from "../api.js";
import {
  formatCOP,
  formatDate,
  formatBytes,
  estadoColor,
  badgeClasses,
} from "../utils.js";

export default function DetailModal({ licitacion, onClose }) {
  const [docs, setDocs] = useState(null);
  const [docsErr, setDocsErr] = useState(null);
  const [downloading, setDownloading] = useState({});
  const [zipping, setZipping] = useState(false);

  const id = licitacion.id_del_portafolio;

  useEffect(() => {
    let alive = true;
    setDocs(null);
    setDocsErr(null);
    fetchDocumentos(id)
      .then((d) => alive && setDocs(d))
      .catch((e) => alive && setDocsErr(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function descargarDocumento(doc) {
    const docId = doc.id_documento;
    setDownloading((s) => ({ ...s, [docId]: true }));
    try {
      const res = await fetch(urlDescargaDocumento(docId));
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.nombre_archivo || `documento_${docId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(`No se pudo descargar el documento: ${e.message}`);
    } finally {
      setDownloading((s) => ({ ...s, [docId]: false }));
    }
  }

  async function descargarZip() {
    setZipping(true);
    try {
      const res = await fetch(urlDescargaZip(id));
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}_documentos.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(`No se pudo descargar el ZIP: ${e.message}`);
    } finally {
      setZipping(false);
    }
  }

  const color = estadoColor(licitacion.estado_del_procedimiento);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-full sm:max-h-[92vh] overflow-hidden flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex-1 min-w-0">
            <span className={`badge ${badgeClasses(color)}`}>
              {licitacion.estado_del_procedimiento || "Sin estado"}
            </span>
            <h2 className="mt-2 font-bold text-xl text-slate-900 dark:text-slate-50 leading-snug">
              {licitacion.nombre_del_procedimiento}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
              {licitacion.id_del_portafolio} · {licitacion.referencia_del_proceso || "—"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost p-2 shrink-0"
            aria-label="Cerrar"
          >
            <I.X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-5 grid sm:grid-cols-2 gap-4">
            <Info label="Entidad" icon={<I.Building className="w-4 h-4" />}>
              {licitacion.entidad}
            </Info>
            <Info label="NIT" icon={<I.Doc className="w-4 h-4" />}>
              {licitacion.nit_entidad || "—"}
            </Info>
            <Info label="Ubicación" icon={<I.Map className="w-4 h-4" />}>
              {[licitacion.ciudad_entidad, licitacion.departamento_entidad]
                .filter(Boolean)
                .join(", ") || "—"}
            </Info>
            <Info label="Modalidad" icon={<I.Filter className="w-4 h-4" />}>
              {licitacion.modalidad_de_contratacion || "—"}
            </Info>
            <Info label="Tipo de contrato" icon={<I.Doc className="w-4 h-4" />}>
              {licitacion.tipo_de_contrato || "—"}
            </Info>
            <Info label="Fase" icon={<I.Clock className="w-4 h-4" />}>
              {licitacion.fase || "—"}
            </Info>
            <Info label="Presupuesto" icon={<I.Money className="w-4 h-4" />}>
              <span className="font-semibold text-base text-slate-900 dark:text-slate-50">
                {formatCOP(licitacion.precio_base)}
              </span>
            </Info>
            <Info label="Duración" icon={<I.Clock className="w-4 h-4" />}>
              {licitacion.duracion
                ? `${licitacion.duracion} ${licitacion.unidad_de_duracion || ""}`
                : "—"}
            </Info>
            <Info label="Fecha de publicación" icon={<I.Calendar className="w-4 h-4" />}>
              {formatDate(licitacion.fecha_de_publicacion_del)}
            </Info>
            <Info label="Última publicación" icon={<I.Calendar className="w-4 h-4" />}>
              {formatDate(licitacion.fecha_de_ultima_publicaci)}
            </Info>
          </div>

          {licitacion.descripci_n_del_procedimiento && (
            <div className="px-5 pb-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                Descripción
              </h3>
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                {licitacion.descripci_n_del_procedimiento}
              </p>
            </div>
          )}

          {licitacion.adjudicado === "Si" && (
            <div className="mx-5 mb-5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200 dark:ring-emerald-500/20 p-4">
              <h3 className="font-semibold text-emerald-900 dark:text-emerald-200 mb-2">
                Adjudicación
              </h3>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <Info label="Proveedor adjudicado">
                  {licitacion.nombre_del_proveedor || "—"}
                </Info>
                <Info label="NIT proveedor">
                  {licitacion.nit_del_proveedor_adjudicado || "—"}
                </Info>
                <Info label="Valor adjudicado">
                  {formatCOP(licitacion.valor_total_adjudicacion)}
                </Info>
              </div>
            </div>
          )}

          <div className="px-5 pb-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                <I.Doc className="w-4 h-4" /> Documentos del proceso
                {docs?.length > 0 && (
                  <span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {docs.length}
                  </span>
                )}
              </h3>
              {docs?.length > 0 && (
                <button
                  className="btn-primary"
                  onClick={descargarZip}
                  disabled={zipping}
                >
                  {zipping ? (
                    <>
                      <I.Spinner className="w-4 h-4 animate-spin" />
                      Empaquetando…
                    </>
                  ) : (
                    <>
                      <I.Package className="w-4 h-4" /> Descargar todo (ZIP)
                    </>
                  )}
                </button>
              )}
            </div>

            {docs === null && !docsErr && (
              <div className="space-y-2">
                <div className="skeleton h-12" />
                <div className="skeleton h-12" />
                <div className="skeleton h-12" />
              </div>
            )}

            {docsErr && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 ring-1 ring-rose-200 dark:ring-rose-500/20 p-3 text-sm text-rose-700 dark:text-rose-300">
                {docsErr}
              </div>
            )}

            {docs && docs.length === 0 && (
              <div className="text-center py-8 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-500 dark:text-slate-400">
                <I.Doc className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Esta licitación no tiene documentos publicados en el dataset abierto de SECOP II.
                {licitacion.urlproceso?.url && (
                  <div className="mt-2">
                    <a
                      href={licitacion.urlproceso.url}
                      target="_blank"
                      rel="noopener"
                      className="text-brand-600 dark:text-brand-400 inline-flex items-center gap-1 hover:underline"
                    >
                      Ver en SECOP II <I.External className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {docs && docs.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
                {docs.map((d) => (
                  <li
                    key={d.id_documento}
                    className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 flex items-center justify-center shrink-0 text-[10px] font-bold uppercase">
                      {(d.extensi_n || "doc").slice(0, 4)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {d.nombre_archivo}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex gap-2 flex-wrap">
                        <span>{formatBytes(d.tamanno_archivo)}</span>
                        <span>·</span>
                        <span>{formatDate(d.fecha_carga)}</span>
                      </div>
                    </div>
                    <button
                      className="btn-secondary"
                      onClick={() => descargarDocumento(d)}
                      disabled={downloading[d.id_documento]}
                    >
                      {downloading[d.id_documento] ? (
                        <I.Spinner className="w-4 h-4 animate-spin" />
                      ) : (
                        <I.Download className="w-4 h-4" />
                      )}
                      <span className="hidden sm:inline">Descargar</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {licitacion.urlproceso?.url && (
          <div className="border-t border-slate-200 dark:border-slate-800 p-3 flex justify-end bg-slate-50 dark:bg-slate-900/50">
            <a
              href={licitacion.urlproceso.url}
              target="_blank"
              rel="noopener"
              className="btn-ghost text-sm"
            >
              Ver en SECOP II <I.External className="w-4 h-4" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, icon, children }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-sm text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  );
}
