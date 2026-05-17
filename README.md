# SECOP II Viewer

Aplicación web moderna que consume la API pública de **SECOP II** (Sistema Electrónico de Contratación Pública de Colombia) y permite explorar, filtrar y descargar las licitaciones y sus documentos.

## Características

- Listado de licitaciones más recientes con tarjetas limpias.
- Búsqueda por objeto, entidad y referencia.
- Filtros por entidad, estado, departamento, fecha y rango de presupuesto.
- Ordenamiento (fecha, presupuesto, entidad).
- Paginación con navegación.
- Vista de detalle con toda la información del proceso.
- **Descarga directa** de documentos individuales desde la propia interfaz (sin redirigir).
- **Descarga ZIP** con todos los documentos del proceso en un solo paquete.
- Modo oscuro (con persistencia y respeto a preferencia del sistema).
- Diseño responsivo (móvil, tablet, desktop).
- Indicadores visuales (badges) para estados y carga.
- Caché backend de respuestas para mejor rendimiento.

## Arquitectura

```
secop-app/
├── backend/        Node.js + Express
│   └── src/
│       ├── server.js     Endpoints REST + descargas (proxy a SECOP II)
│       └── socrata.js    Cliente para datos.gov.co (Socrata SODA API)
└── frontend/       React 18 + Vite + Tailwind CSS
    └── src/
        ├── App.jsx
        ├── api.js
        ├── utils.js
        └── components/
            ├── LicitacionCard.jsx
            ├── Filters.jsx
            ├── DetailModal.jsx
            └── Icons.jsx
```

### Datasets utilizados (datos.gov.co)

| Dataset | ID | Uso |
|---|---|---|
| SECOP II - Procesos de Contratación | `p6dx-8zbt` | Listado y detalle |
| SECOP II - Archivos Descarga Desde 2025 | `dmgg-8hin` | Documentos 2025+ |
| SECOP II - Archivos Descarga Histórico 2023 | `3skv-9na7` | Documentos 2023 |
| SECOP II - Archivos Descarga Histórico 2022 | `kgcd-kt7i` | Documentos 2022 |
| SECOP II - Archivos Descarga Hasta 2021 | `f8va-cf4m` | Documentos hasta 2021 |

Los binarios se sirven desde `community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=…` y el backend actúa como proxy para evitar CORS y soportar empaquetado ZIP.

## Endpoints del backend

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/facets` | Estados y departamentos disponibles |
| GET | `/api/licitaciones` | Listado con filtros y paginación |
| GET | `/api/licitaciones/:idPortafolio` | Detalle de un proceso |
| GET | `/api/licitaciones/:idPortafolio/documentos` | Documentos de un proceso |
| GET | `/api/licitaciones/:idPortafolio/zip` | ZIP con todos los documentos |
| GET | `/api/documentos/:id/descargar` | Descarga de un documento individual |

Parámetros de `/api/licitaciones`:
`page`, `pageSize`, `search`, `entidad`, `departamento`, `estado`, `fechaDesde`, `fechaHasta`, `presupuestoMin`, `presupuestoMax`, `ordenarPor`, `orden`.

## Requisitos

- Node.js 18+ (probado en 24)
- npm 9+

## Instrucciones de ejecución

### 1. Backend

```powershell
cd secop-app\backend
npm install
npm start
```

Backend en: <http://localhost:4000>

> Opcional: definir `SOCRATA_APP_TOKEN` para subir el rate limit de Socrata.
> ```powershell
> $env:SOCRATA_APP_TOKEN="tu-token"; npm start
> ```

### 2. Frontend

En otra terminal:

```powershell
cd secop-app\frontend
npm install
npm run dev
```

Frontend en: <http://localhost:5173>

El dev server de Vite hace proxy de `/api/*` → `http://localhost:4000`.

### Build de producción

```powershell
cd secop-app\frontend
npm run build
npm run preview
```

## Cómo se prueba

1. Abrí <http://localhost:5173>.
2. La aplicación lista las licitaciones más recientes.
3. Probá la búsqueda con `HOSPITAL`, filtrá por estado / departamento / fecha / presupuesto.
4. Hacé clic en una tarjeta para abrir el detalle.
5. En la sección **Documentos del proceso**:
   - **Descargar (uno)**: descarga directamente al navegador con el nombre original.
   - **Descargar todo (ZIP)**: empaqueta y descarga todos los documentos.

### Procesos de ejemplo con documentos

- `CO1.BDOS.8368666` — 5 PDFs (Hospital San Cristóbal de Ciénaga)
- `CO1.BDOS.10040890` — 7 PDFs (Hospital Regional de Sogamoso, feb-2026)

## Notas sobre la API

- La API pública de SECOP II vía Socrata limita peticiones por IP/aplicación. El backend cachea las respuestas durante 5 minutos para mejorar latencia y reducir consumo.
- No todos los procesos tienen documentos asociados publicados en los datasets abiertos. Cuando es el caso, la UI lo informa y ofrece un enlace al portal SECOP II.

## Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, Express 4, undici, archiver, node-cache
- **Datos**: API SECOP II (datos.gov.co - Socrata SODA)


### Documentacion de Cambios realizados - Byron

## Filtros de busqueda de "solo documentos descargables"

1. Específicamente en el archivo backend/src/db.js donde se gestiona la base de datos local (que efectivamente funciona con un diccionario let data = {}).

Ahí existe la función listSaved, la cual recibe un parámetro llamado tienePdfs. Dependiendo del valor de ese parámetro, se filtran las licitaciones (que son los valores del diccionario obtenidos mediante Object.values(data)) de la siguiente manera:

- Con PDFs: Si envías tienePdfs como "true", "1", o "con", devolverá únicamente las licitaciones donde tiene_pdfs === true.
- Sin PDFs: Si envías "false", "0", o "sin", devolverá aquellas donde tiene_pdfs === false.
- Desconocido (Aún no verificado): Si envías "unknown" o "desconocido", devolverá las que tienen tiene_pdfs == null (es decir, aquellas a las que aún no se les han consultado los documentos a la API).

2. La simulación muestra que las 9 licitaciones filtradas todas tienen documentos ✓. Sin embargo, la API de SECOP devuelve el ID CO1.BDOS.10175312 duplicado.

El problema está en el caché del backend. El backend usa node-cache con TTL de 5 minutos. Cuando el filtro se ejecutó por primera vez para ti, probablemente los resultados del caché incluían licitaciones que ya no tienen documentos disponibles (datos desactualizados de SECOP), o la consulta SECOP devolvió resultados diferentes.

El caché del cross-ref tiene TTL de 10 minutos (cache.set(cacheKey, set, 600)).

- De-duplicación: SECOP devuelve el mismo id_del_portafolio múltiples veces (encontré 10 IDs duplicados en 300 candidatos). Ahora se eliminan duplicados antes del cruce.

- Verificación individual: Después del cruce batch rápido (que actúa como pre-filtro), cada licitación candidata se verifica individualmente usando getDocumentosPorProceso. Solo las que realmente tienen documentos pasan al resultado final. Esto elimina los falsos positivos causados por inconsistencias o caché de la API de SECOP.

- Rendimiento: Como el batch pre-filtra a un conjunto pequeño (~9 items de 287 únicos), la verificación individual no agrega retraso significativo. Las consultas a SECOP además se cachean automáticamente

3. Los cambios que resolvieron el problema:

- Backend (socrata.js): De-duplicación de candidatos + verificación individual de documentos para eliminar falsos positivos
- Frontend (App.jsx): De-duplicación de items por id_del_portafolio antes de guardar en el state de React, evitando keys duplicadas que corrompían el DOM

##