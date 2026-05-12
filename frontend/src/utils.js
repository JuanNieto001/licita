export function formatCOP(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function formatDateRel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} días`;
  if (days < 365) return `Hace ${Math.floor(days / 30)} meses`;
  return `Hace ${Math.floor(days / 365)} años`;
}

export function formatBytes(b) {
  const n = Number(b);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function estadoColor(estado) {
  const e = (estado || "").toLowerCase();
  if (e.includes("adjudic")) return "emerald";
  if (e.includes("celebr")) return "emerald";
  if (e.includes("present")) return "blue";
  if (e.includes("convocator")) return "indigo";
  if (e.includes("borrador")) return "slate";
  if (e.includes("desierto") || e.includes("revocado")) return "rose";
  if (e.includes("termin")) return "violet";
  if (e.includes("seleccion")) return "amber";
  if (e.includes("liquidad")) return "violet";
  if (e.includes("cancela")) return "rose";
  return "slate";
}

export function badgeClasses(color) {
  const map = {
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
    indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200",
    rose: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  };
  return map[color] || map.slate;
}

export function truncate(text, n = 180) {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).trim() + "…" : text;
}
