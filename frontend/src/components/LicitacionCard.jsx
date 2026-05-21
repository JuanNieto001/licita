import { I } from "./Icons.jsx";
import {
  formatCOP,
  formatDate,
  formatDateRel,
  estadoColor,
  badgeClasses,
  truncate,
} from "../utils.js";

export default function LicitacionCard({ item, onClick }) {
  const color = estadoColor(item.estado_del_procedimiento);
  return (
    <button
      onClick={onClick}
      className="card p-5 text-left w-full group animate-slide-up"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className={`badge ${badgeClasses(color)}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          {item.estado_del_procedimiento || "Sin estado"}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 shrink-0">
          <I.Clock className="w-3.5 h-3.5" />
          {formatDateRel(item.fecha_de_publicacion_del)}
        </span>
      </div>

      {item.fase &&
        (item.fase.toLowerCase().includes("oferta") ||
          item.fase.toLowerCase().includes("observ")) && (
          <div className="w-full rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 px-3 py-1.5 text-xs font-medium mb-3">
            {item.fase}
          </div>
        )}

      {item.referencia_del_proceso && (
        <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-1 tracking-wide">
          {item.referencia_del_proceso}
        </div>
      )}

      <h3 className="font-semibold text-slate-900 dark:text-slate-50 leading-snug mb-1.5 line-clamp-2 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
        {item.nombre_del_procedimiento || "Sin título"}
      </h3>

      <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-4">
        {truncate(item.descripci_n_del_procedimiento, 160)}
      </p>

      <div className="space-y-2 text-sm">
        <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
          <I.Building className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
          <span className="line-clamp-1">{item.entidad}</span>
        </div>
        {item.departamento_entidad && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <I.Map className="w-4 h-4 shrink-0" />
            <span>
              {item.ciudad_entidad ? `${item.ciudad_entidad}, ` : ""}
              {item.departamento_entidad}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <I.Money className="w-3.5 h-3.5" /> Presupuesto
          </div>
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {formatCOP(item.precio_base)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 justify-end">
            <I.Calendar className="w-3.5 h-3.5" /> Publicación
          </div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {formatDate(item.fecha_de_publicacion_del)}
          </div>
        </div>
      </div>
    </button>
  );
}
