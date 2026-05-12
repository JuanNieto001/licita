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
