const BASE = "/api";

async function jsonFetch(path, options) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export function fetchLicitaciones(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  }
  return jsonFetch(`/licitaciones?${qs.toString()}`);
}

export function fetchLicitacion(id) {
  return jsonFetch(`/licitaciones/${encodeURIComponent(id)}`);
}

export function fetchDocumentos(id) {
  return jsonFetch(`/licitaciones/${encodeURIComponent(id)}/documentos`);
}

export function fetchAnalisisPliego(id) {
  return jsonFetch(`/licitaciones/${encodeURIComponent(id)}/analisis-pliego`);
}

export function fetchFacets() {
  return jsonFetch(`/facets`);
}

export function urlDescargaDocumento(id) {
  return `${BASE}/documentos/${encodeURIComponent(id)}/descargar`;
}

export function urlDescargaZip(idPortafolio) {
  return `${BASE}/licitaciones/${encodeURIComponent(idPortafolio)}/zip`;
}

// ===== Base de datos local =====
export function fetchDbStats() {
  return jsonFetch(`/db/stats`);
}

export function fetchDbLicitaciones(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  }
  return jsonFetch(`/db/licitaciones?${qs.toString()}`);
}

export function deleteDbLicitacion(id) {
  return jsonFetch(`/db/licitaciones/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function clearDb() {
  return jsonFetch(`/db`, { method: "DELETE" });
}

export function syncPdfs(ids) {
  return jsonFetch(`/db/sync-pdfs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}
