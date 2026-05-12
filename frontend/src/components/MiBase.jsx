import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDbLicitaciones,
  fetchDbStats,
  clearDb,
  deleteDbLicitacion,
  syncPdfs,
} from "../api.js";
import { I } from "./Icons.jsx";
import {
  formatCOP,
  formatDate,
  formatDateRel,
  estadoColor,
  badgeClasses,
  truncate,
} from "../utils.js";

const PAGE_SIZE = 12;

function useDebounce(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function MiBase({ onOpenDetalle }) {
  const [stats, setStats] = useState(null);
  const [tienePdfs, setTienePdfs] = useState(""); // "" | "con" | "sin" | "desconocido"
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const reqIdRef = useRef(0);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      search: debounced || undefined,
      tienePdfs: tienePdfs || undefined,
    }),
    [page, debounced, tienePdfs],
  );

  function refreshStats() {
    fetchDbStats()
      .then(setStats)
      .catch(() => {});
  }

  useEffect(() => {
    refreshStats();
  }, []);

  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setErr(null);
    fetchDbLicitaciones(params)
      .then((d) => {
        if (myReq !== reqIdRef.current) return;
        setData(d);
      })
      .catch((e) => myReq === reqIdRef.current && setErr(e.message))
      .finally(() => myReq === reqIdRef.current && setLoading(false));
  }, [params]);

  async function handleClear() {
    if (!confirm("¿Vaciar la base local? Esto borra todas las licitaciones guardadas."))
      return;
    await clearDb();
    refreshStats();
    setData({ items: [], total: 0, page: 1, totalPages: 1 });
  }

  async function handleDelete(id) {
    await deleteDbLicitacion(id);
    refreshStats();
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items.filter((x) => x.id !== id),
            total: Math.max(0, d.total - 1),
          }
        : d,
    );
  }

  async function handleSyncPdfs() {
    if (!data?.items?.length) return;
    setSyncing(true);
    try {
      const ids = data.items.map((x) => x.id).filter(Boolean);
      const r = await syncPdfs(ids);
      // refetch
      const d = await fetchDbLicitaciones(params);
      setData(d);
      refreshStats();
      alert(
        `Sincronizados ${r.processed} de ${r.total}. Con PDFs: ${r.conPdfs}.`,
      );
    } catch (e) {
      alert("Error al sincronizar: " + e.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
              Mi base local
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Las licitaciones que ya viste se guardan acá como diccionarios JSON,
              con sus atributos y PDFs si los tiene.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={handleSyncPdfs}
              disabled={syncing || !data?.items?.length}
              title="Consulta PDFs en la API para las licitaciones visibles"
            >
              {syncing ? (
                <I.Spinner className="w-4 h-4 animate-spin" />
              ) : (
                <I.Doc className="w-4 h-4" />
              )}
              Verificar PDFs visibles
            </button>
            <button
              className="btn-ghost text-rose-600 dark:text-rose-400"
              onClick={handleClear}
              disabled={!stats?.total}
            >
              <I.X className="w-4 h-4" /> Vaciar base
            </button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard label="Total" value={stats.total} />
            <StatCard
              label="Con PDFs"
              value={stats.conPdfs}
              color="emerald"
            />
            <StatCard label="Sin PDFs" value={stats.sinPdfs} color="rose" />
            <StatCard
              label="Sin verificar"
              value={stats.sinVerificar}
              color="amber"
            />
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <I.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Buscar en mi base…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterPill
            active={!tienePdfs}
            onClick={() => {
              setTienePdfs("");
              setPage(1);
            }}
          >
            Todas {stats && `(${stats.total})`}
          </FilterPill>
          <FilterPill
            active={tienePdfs === "con"}
            onClick={() => {
              setTienePdfs("con");
              setPage(1);
            }}
            color="emerald"
          >
            <I.Doc className="w-3.5 h-3.5" /> Con PDFs{" "}
            {stats && `(${stats.conPdfs})`}
          </FilterPill>
          <FilterPill
            active={tienePdfs === "sin"}
            onClick={() => {
              setTienePdfs("sin");
              setPage(1);
            }}
            color="rose"
          >
            <I.X className="w-3.5 h-3.5" /> Sin PDFs{" "}
            {stats && `(${stats.sinPdfs})`}
          </FilterPill>
          <FilterPill
            active={tienePdfs === "desconocido"}
            onClick={() => {
              setTienePdfs("desconocido");
              setPage(1);
            }}
            color="amber"
          >
            Sin verificar {stats && `(${stats.sinVerificar})`}
          </FilterPill>
        </div>
      </div>

      {err && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 ring-1 ring-rose-200 dark:ring-rose-500/20 p-4 text-rose-700 dark:text-rose-300">
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-5 w-24" />
              <div className="skeleton h-5 w-full" />
              <div className="skeleton h-4 w-3/4" />
            </div>
          ))}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="text-center py-12">
          <I.Doc className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-700" />
          <div className="text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            {stats?.total === 0 ? (
              <>
                Tu base está vacía. Navegá el <strong>Catálogo SECOP</strong> y
                las licitaciones que veas se guardan automáticamente acá.
              </>
            ) : (
              "Sin resultados con esos filtros."
            )}
          </div>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div
          className={`grid sm:grid-cols-2 xl:grid-cols-3 gap-4 ${loading ? "opacity-60" : ""}`}
        >
          {data.items.map((it) => (
            <SavedCard
              key={it.id}
              item={it}
              onOpen={() => onOpenDetalle?.(it.id)}
              onDelete={() => handleDelete(it.id)}
            />
          ))}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <nav className="flex justify-center gap-1 mt-6">
          <button
            className="btn-ghost px-3"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <I.Chevron className="w-4 h-4 rotate-180" />
          </button>
          <span className="px-3 py-2 text-sm">
            Página {page} de {data.totalPages}
          </span>
          <button
            className="btn-ghost px-3"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <I.Chevron className="w-4 h-4" />
          </button>
        </nav>
      )}
    </div>
  );
}

function StatCard({ label, value, color = "slate" }) {
  const map = {
    slate: "text-slate-900 dark:text-slate-100",
    emerald: "text-emerald-700 dark:text-emerald-300",
    rose: "text-rose-700 dark:text-rose-300",
    amber: "text-amber-700 dark:text-amber-300",
  };
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-200 dark:ring-slate-800 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-xl font-bold ${map[color]}`}>
        {value.toLocaleString("es-CO")}
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, color = "brand", children }) {
  const map = {
    brand: active
      ? "bg-brand-600 text-white"
      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-300 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700",
    emerald: active
      ? "bg-emerald-600 text-white"
      : "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300 dark:ring-emerald-700/50 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
    rose: active
      ? "bg-rose-600 text-white"
      : "bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-300 ring-1 ring-rose-300 dark:ring-rose-700/50 hover:bg-rose-50 dark:hover:bg-rose-500/10",
    amber: active
      ? "bg-amber-600 text-white"
      : "bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700/50 hover:bg-amber-50 dark:hover:bg-amber-500/10",
  };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${map[color]}`}
    >
      {children}
    </button>
  );
}

function SavedCard({ item, onOpen, onDelete }) {
  const color = estadoColor(item.estado);
  return (
    <div className="card p-5 group relative">
      <button
        className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 transition-all"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Eliminar de la base"
      >
        <I.X className="w-4 h-4" />
      </button>

      <button onClick={onOpen} className="text-left w-full">
        <div className="flex flex-wrap gap-1.5 mb-3 pr-7">
          <span className={`badge ${badgeClasses(color)}`}>
            {item.estado || "Sin estado"}
          </span>
          {item.tiene_pdfs === true && (
            <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
              <I.Doc className="w-3 h-3" /> {item.pdfs?.length || 0} PDFs
            </span>
          )}
          {item.tiene_pdfs === false && (
            <span className="badge bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300">
              Sin PDFs
            </span>
          )}
          {item.tiene_pdfs == null && (
            <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
              Sin verificar
            </span>
          )}
        </div>

        <h3 className="font-semibold text-slate-900 dark:text-slate-50 leading-snug mb-1.5 line-clamp-2 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
          {item.objeto || "Sin título"}
        </h3>

        <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-3">
          {truncate(item.descripcion, 160)}
        </p>

        <div className="space-y-1.5 text-sm">
          <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
            <I.Building className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
            <span className="line-clamp-1">{item.entidad}</span>
          </div>
          {item.modalidad && (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
              <I.Filter className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{item.modalidad}</span>
            </div>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Presupuesto
            </div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {formatCOP(item.presupuesto)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Publicación
            </div>
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {formatDate(item.fecha_publicacion)}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
