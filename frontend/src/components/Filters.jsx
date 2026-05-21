import { I } from "./Icons.jsx";

export default function Filters({
  filters,
  onChange,
  onReset,
  facets,
  open,
  onClose,
}) {
  const set = (k, v) => onChange({ ...filters, [k]: v, page: 1 });

  return (
    <aside
      className={`fixed lg:static inset-y-0 right-0 w-80 lg:w-72 shrink-0 bg-white dark:bg-slate-900
        border-l lg:border-l-0 lg:border-r border-slate-200 dark:border-slate-800
        transform lg:transform-none transition-transform lg:transition-none z-30 lg:z-auto
        ${open ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}
    >
      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between lg:hidden">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <I.Filter className="w-5 h-5" /> Filtros
            </h2>
            <button onClick={onClose} className="btn-ghost p-1.5">
              <I.X className="w-5 h-5" />
            </button>
          </div>

          <h2 className="hidden lg:flex font-semibold items-center gap-2 text-slate-700 dark:text-slate-200">
            <I.Filter className="w-4 h-4" /> Filtros
          </h2>

          <Field label="Entidad contratante">
            <input
              className="input"
              placeholder="Ej: ALCALDÍA, ICA, INVÍAS…"
              value={filters.entidad || ""}
              onChange={(e) => set("entidad", e.target.value)}
            />
          </Field>

          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200 dark:ring-emerald-500/20 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                checked={!!filters.soloAbiertos}
                onChange={(e) => set("soloAbiertos", e.target.checked ? "1" : "")}
              />
              <span className="text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  Solo abiertos para postularse
                </span>
                <span className="block text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Procesos publicados y en fase de presentación de ofertas.
                  Excluye seleccionados, cancelados, en evaluación, etc.
                </span>
              </span>
            </label>
          </div>

          {!filters.soloAbiertos && (
            <Field label="Estado del proceso">
              <select
                className="input"
                value={filters.estado || ""}
                onChange={(e) => set("estado", e.target.value)}
              >
                <option value="">Todos</option>
                {(facets?.estados || []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="rounded-xl bg-brand-50 dark:bg-brand-500/10 ring-1 ring-brand-200 dark:ring-brand-500/20 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-brand-800 dark:text-brand-200">★ Solo Licitaciones Públicas (LP)</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Los resultados muestran únicamente procesos de Licitación Pública de ingeniería civil.
            </p>
          </div>

          <div className="rounded-xl bg-violet-50 dark:bg-violet-500/10 ring-1 ring-violet-200 dark:ring-violet-500/20 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-violet-800 dark:text-violet-200">📄 Solo con documentos descargables</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Se muestran únicamente licitaciones que tienen documentos
              descargables (PDF, Word, etc.) en la API pública de SECOP II.
            </p>
          </div>



          <Field label="Departamento">
            <select
              className="input"
              value={filters.departamento || ""}
              onChange={(e) => set("departamento", e.target.value)}
            >
              <option value="">Todos</option>
              {(facets?.departamentos || []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Fecha de publicación">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                className="input"
                value={filters.fechaDesde || ""}
                onChange={(e) => set("fechaDesde", e.target.value)}
              />
              <input
                type="date"
                className="input"
                value={filters.fechaHasta || ""}
                onChange={(e) => set("fechaHasta", e.target.value)}
              />
            </div>
          </Field>

          <Field label="Presupuesto (COP)">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                placeholder="Mínimo"
                className="input"
                value={filters.presupuestoMin || ""}
                onChange={(e) => set("presupuestoMin", e.target.value)}
              />
              <input
                type="number"
                min="0"
                placeholder="Máximo"
                className="input"
                value={filters.presupuestoMax || ""}
                onChange={(e) => set("presupuestoMax", e.target.value)}
              />
            </div>
          </Field>

          <Field label="Ordenar por">
            <div className="grid grid-cols-2 gap-2">
              <select
                className="input"
                value={filters.ordenarPor || "fecha_de_publicacion_del"}
                onChange={(e) => set("ordenarPor", e.target.value)}
              >
                <option value="fecha_de_publicacion_del">Fecha</option>
                <option value="precio_base">Presupuesto</option>
                <option value="entidad">Entidad</option>
              </select>
              <select
                className="input"
                value={filters.orden || "DESC"}
                onChange={(e) => set("orden", e.target.value)}
              >
                <option value="DESC">Descendente</option>
                <option value="ASC">Ascendente</option>
              </select>
            </div>
          </Field>

          <button
            onClick={onReset}
            className="btn-secondary w-full"
            type="button"
          >
            <I.X className="w-4 h-4" /> Limpiar filtros
          </button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
