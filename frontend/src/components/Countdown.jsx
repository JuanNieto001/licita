import { useEffect, useState } from "react";
import { I } from "./Icons.jsx";

function partes(restaMs) {
  const s = Math.max(0, Math.floor(restaMs / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return { d, hh, mm, ss };
}

/**
 * Cuenta regresiva en tiempo real hasta el cierre de recepción de ofertas.
 * Azul con tiempo de sobra, ámbar a menos de 3 días, rojo a menos de
 * 24 horas y gris cuando ya cerró.
 *
 * `exacto`: los datos abiertos solo publican el DÍA de cierre (medianoche);
 * la hora exacta solo está en la página de SECOP. Cuando el usuario la fija
 * (exacto=true) el contador coincide al segundo con el de SECOP; mientras
 * tanto se muestra "≈" contando hacia la medianoche del día de cierre.
 */
export default function Countdown({ hastaMs, exacto = false, className = "" }) {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!hastaMs) return null;
  const resta = hastaMs - ahora;
  const tooltip = exacto
    ? "Hora exacta fijada manualmente desde SECOP"
    : "Los datos abiertos solo publican el día de cierre: el contador apunta a las 00:00 de ese día. Fija la hora exacta de SECOP en el detalle.";

  if (resta <= 0) {
    return (
      <div
        title={tooltip}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300 px-3 py-1.5 text-xs font-semibold ${className}`}
      >
        <I.Clock className="w-3.5 h-3.5 shrink-0" />
        {exacto ? "Cerrada — ya no recibe ofertas" : "Cierra hoy (verificar hora en SECOP)"}
      </div>
    );
  }

  const { d, hh, mm, ss } = partes(resta);
  const DIA = 24 * 3600 * 1000;
  const colores =
    resta < DIA
      ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
      : resta < 3 * DIA
        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
        : "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300";

  return (
    <div
      title={tooltip}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold tabular-nums ${colores} ${className}`}
    >
      <I.Clock className="w-3.5 h-3.5 shrink-0" />
      <span>Cierra en</span>
      <span className="font-bold">
        {exacto ? "" : "≈ "}
        {d > 0 ? `${d}d ` : ""}
        {hh}:{mm}:{ss}
      </span>
    </div>
  );
}
