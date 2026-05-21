import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLicitaciones,
  fetchFacets,
  fetchLicitacion,
  fetchDbStats,
} from "./api.js";
import LicitacionCard from "./components/LicitacionCard.jsx";
import Filters from "./components/Filters.jsx";
import DetailModal from "./components/DetailModal.jsx";
import MiBase from "./components/MiBase.jsx";
import { I } from "./components/Icons.jsx";

const PAGE_SIZE = 12;

function useDebounce(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function App() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    ordenarPor: "fecha_de_publicacion_del",
    orden: "DESC",
    soloAbiertos: "1",
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [facets, setFacets] = useState({ estados: [], departamentos: [] });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("catalogo"); // "catalogo" | "mibase"
  const [dbCount, setDbCount] = useState(0);
  const [theme, setTheme] = useState(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );

  const reqIdRef = useRef(0);

  useEffect(() => {
    fetchFacets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    const tick = () =>
      fetchDbStats()
        .then((s) => setDbCount(s.total || 0))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  async function openByIdFromDb(id) {
    try {
      const full = await fetchLicitacion(id);
      setSelected(full);
    } catch {
      // fallback: fetch from local db
      const local = await (
        await fetch(`/api/db/licitaciones/${encodeURIComponent(id)}`)
      ).json();
      // Map to the shape DetailModal expects
      setSelected({
        id_del_portafolio: local.id,
        id_del_proceso: local.id_proceso,
        referencia_del_proceso: local.referencia,
        entidad: local.entidad,
        nit_entidad: local.nit_entidad,
        departamento_entidad: local.departamento,
        ciudad_entidad: local.ciudad,
        nombre_del_procedimiento: local.objeto,
        descripci_n_del_procedimiento: local.descripcion,
        precio_base: local.presupuesto,
        estado_del_procedimiento: local.estado,
        fase: local.fase,
        modalidad_de_contratacion: local.modalidad,
        tipo_de_contrato: local.tipo_contrato,
        fecha_de_publicacion_del: local.fecha_publicacion,
        fecha_de_ultima_publicaci: local.fecha_ultima_publicacion,
        duracion: local.duracion,
        unidad_de_duracion: local.unidad_duracion,
        urlproceso: local.url_proceso ? { url: local.url_proceso } : null,
        adjudicado: local.adjudicado ? "Si" : "No",
        nombre_del_proveedor: local.proveedor_adjudicado,
        nit_del_proveedor_adjudicado: local.nit_proveedor,
        valor_total_adjudicacion: local.valor_adjudicado,
      });
    }
  }

  const queryFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch || undefined }),
    [filters, debouncedSearch],
  );

  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    fetchLicitaciones(queryFilters)
      .then((d) => {
        if (myReq !== reqIdRef.current) return;
        // De-duplicar: SECOP puede devolver el mismo id_del_portafolio varias veces,
        // lo que causa keys duplicadas en React y corrompe la actualización del DOM.
        const seen = new Set();
        const uniqueItems = [];
        for (const item of d.items) {
          const key = item.id_del_portafolio || item.id_del_proceso;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueItems.push(item);
          }
        }
        setData({ ...d, items: uniqueItems });
      })
      .catch((e) => {
        if (myReq !== reqIdRef.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (myReq !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [queryFilters]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  function resetFilters() {
    setFilters({
      page: 1,
      pageSize: PAGE_SIZE,
      ordenarPor: "fecha_de_publicacion_del",
      orden: "DESC",
      soloAbiertos: "1",
    });
    setSearch("");
  }

  const totalPages = data?.totalPages || 1;
  const page = filters.page;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-white/30 dark:bg-slate-950/30 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center shadow-sm">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M4 6h16M4 12h12M4 18h14" />
              </svg>
            </div>
            <div className="hidden sm:block">
              <div className="font-bold text-slate-900 dark:text-slate-50 leading-none flex items-center gap-2">
                SECOP II Viewer
                <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-300 text-[10px] py-0.5">
                  Ingeniería civil
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Licitaciones de obras y servicios de ingeniería civil — Colombia
              </div>
            </div>
          </div>

          <nav className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mr-auto ml-2">
            <button
              onClick={() => setView("catalogo")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                view === "catalogo"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
            >
              <span className="hidden sm:inline">Catálogo SECOP</span>
              <span className="sm:hidden">Catálogo</span>
            </button>
            <button
              onClick={() => setView("mibase")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                view === "mibase"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
            >
              Mi base
              {dbCount > 0 && (
                <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-300 py-0">
                  {dbCount}
                </span>
              )}
            </button>
          </nav>

          {view === "catalogo" && (
            <div className="flex-1 max-w-xl">
              <div className="relative">
                <I.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-9"
                  placeholder="Buscar por objeto, entidad o referencia…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          )}

          <button
            className="btn-ghost p-2"
            onClick={toggleTheme}
            aria-label="Cambiar tema"
            title="Cambiar tema"
          >
            {theme === "dark" ? (
              <I.Sun className="w-5 h-5" />
            ) : (
              <I.Moon className="w-5 h-5" />
            )}
          </button>
          <button
            className="btn-ghost p-2 lg:hidden"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filtros"
          >
            <I.Filter className="w-5 h-5" />
          </button>
        </div>
      </header>

      {view === "mibase" ? (
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 min-w-0">
          <MiBase onOpenDetalle={openByIdFromDb} />
        </main>
      ) : (
      <div className="flex-1 max-w-7xl w-full mx-auto px-0 lg:px-6 lg:flex lg:gap-6 lg:py-6">
        <Filters
          filters={filters}
          onChange={setFilters}
          onReset={resetFilters}
          facets={facets}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
        />
        {filtersOpen && (
          <div
            className="fixed inset-0 bg-slate-900/50 z-20 lg:hidden"
            onClick={() => setFiltersOpen(false)}
          />
        )}

        <main className="flex-1 px-4 sm:px-6 lg:px-0 py-4 lg:py-0 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {data ? (
                <>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {data.total.toLocaleString("es-CO")}
                  </span>{" "}
                  licitaciones encontradas
                </>
              ) : loading ? (
                "Buscando…"
              ) : (
                ""
              )}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Página {page} de {totalPages}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 ring-1 ring-rose-200 dark:ring-rose-500/20 p-4 text-rose-700 dark:text-rose-300 mb-4">
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card p-5 space-y-3">
                  <div className="skeleton h-5 w-24" />
                  <div className="skeleton h-5 w-full" />
                  <div className="skeleton h-4 w-3/4" />
                  <div className="skeleton h-4 w-1/2" />
                  <div className="skeleton h-10 w-full mt-2" />
                </div>
              ))}
            </div>
          )}

          {data && data.items.length === 0 && (
            <div className="text-center py-16 max-w-lg mx-auto">
              <I.Search className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-700" />
              <div className="text-slate-600 dark:text-slate-400 mb-3">
                No se encontraron licitaciones con esos criterios.
              </div>
              {filters.soloAbiertos && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-200 dark:ring-amber-500/20 p-4 text-sm text-amber-800 dark:text-amber-200 text-left">
                  <strong>Tip:</strong> el dataset abierto de SECOP II tiene un
                  retraso de ~2 meses, por lo que los procesos
                  <em> recién publicados (abiertos)</em> normalmente todavía no
                  tienen sus documentos indexados. Probá desactivar
                  <strong> "Solo abiertos para postularse"</strong> para ver
                  procesos más antiguos que sí tengan documentos descargables.
                </div>
              )}
            </div>
          )}

          {data && data.items.length > 0 && (
            <div
              className={`grid sm:grid-cols-2 xl:grid-cols-3 gap-4 ${loading ? "opacity-60" : ""}`}
            >
              {data.items.map((item) => (
                <LicitacionCard
                  key={item.id_del_portafolio || item.id_del_proceso}
                  item={item}
                  onClick={() => setSelected(item)}
                />
              ))}
            </div>
          )}

          {data && data.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={data.totalPages}
              onChange={(p) => {
                setFilters((f) => ({ ...f, page: p }));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
        </main>
      </div>
      )}

      <footer className="border-t border-slate-200 dark:border-slate-800 py-4 text-center text-xs text-slate-500 dark:text-slate-500">
        Datos: API SECOP II · Colombia Compra Eficiente · datos.gov.co
      </footer>

      {selected && (
        <DetailModal
          licitacion={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Pagination({ page, totalPages, onChange }) {
  const pages = pageRange(page, totalPages);
  return (
    <nav className="flex items-center justify-center gap-1 mt-8">
      <button
        className="btn-ghost px-2 py-1.5 disabled:opacity-30"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Anterior"
      >
        <I.Chevron className="w-4 h-4 rotate-180" />
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-2 text-slate-400">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`min-w-[2.25rem] h-9 rounded-lg text-sm font-medium ${
              p === page
                ? "bg-brand-600 text-white"
                : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        className="btn-ghost px-2 py-1.5 disabled:opacity-30"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Siguiente"
      >
        <I.Chevron className="w-4 h-4" />
      </button>
    </nav>
  );
}

function pageRange(current, total) {
  const max = Math.min(total, 50000);
  const result = [];
  const push = (v) => result.push(v);
  const window = 1;
  push(1);
  if (current - window > 2) push("…");
  for (
    let i = Math.max(2, current - window);
    i <= Math.min(max - 1, current + window);
    i++
  ) {
    push(i);
  }
  if (current + window < max - 1) push("…");
  if (max > 1) push(max);
  return [...new Set(result)];
}
