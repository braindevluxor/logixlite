# LOGIXLITE 🚌

PWA para administrar la flota de transporte particular: vehículos, choferes, sucursales y creación de viajes (vehículo → chofer → pasajeros → destinos ordenados).

## Stack

- **Frontend:** React 18 + Vite + TypeScript + `vite-plugin-pwa` (installable, funciona parcialmente offline)
- **Backend/BD:** Supabase (PostgreSQL + Auth + RLS)
- **Pasajeros:** API externa de Talento Humano (desarrolloluxor.lat)

## 1. Configurar Supabase (una sola vez)

1. Crea un proyecto en [supabase.com](https://supabase.com) (plan gratuito).
2. En **SQL Editor → New query**, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo.
   - Crea las tablas `branches`, `vehicles`, `drivers`, `trips`, `trip_passengers`, `trip_destinations`.
   - Activa RLS con acceso para usuarios autenticados.
   - Siembra las 15 sucursales detectadas en la API (branchID 5–20).
3. En **Authentication → Providers → Email**, desactiva "Confirm email" si quieres altas de usuario inmediatas.
4. En **Authentication → Users → Add user**, crea tu usuario y contraseña.
5. En **Project Settings → API**, copia la **Project URL** y la **anon key**.

## 2. Configurar el proyecto local

```bash
cp .env.example .env
# Edita .env y pega tus claves de Supabase

npm install
npm run dev
```

`.env`:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU-ANON-KEY
VITE_TALENTO_HUMANO_URL=https://desarrolloluxor.lat/api/talentohumano
VITE_TALENTO_HUMANO_KEY=PBDFeysVkGLa0zRfq5bYEUtNbmV0akhtN3hFakRES3E2cU82TVE9PQ==
```

## 3. Uso

| Sección | Qué hace |
|---|---|
| **Vehículos** | Alta/baja de vehículos con **capacidad de puestos**, placa, estado |
| **Choferes** | Alta/baja de choferes (cédula, licencia, teléfono) |
| **Sucursales** | Listado editable; el *branchID* enlaza con la API de empleados |
| **Viajes** | Asistente de 4 pasos: vehículo + chofer → pasajeros (API por sucursal, con cupo) → destinos con orden → confirmar |
| **Detalle del viaje** | Cambiar estado (programado → en curso → finalizado/cancelado), ver pasajeros y destinos |

### API de pasajeros

```
GET https://desarrolloluxor.lat/api/talentohumano/employee/samir?branchID={branchID}
Header: API_KEY: <clave>
```

Devuelve: `dni, name, lastname, role_name, department_name, branch_id, branch_name, active, …`

> ⚠️ **CORS:** esa API solo permite los headers `token, Content-Type` en su
> preflight, pero el endpoint exige `API_KEY`, así que el navegador bloquea la
> petición directa. Por eso la app nunca llama a la API desde el navegador:
>
> - **Desarrollo:** Vite resuelve `/api/talento/*` con un proxy embebido en
>   `vite.config.ts` (agrega `API_KEY` en servidor, sin CORS).
> - **Producción:** la Edge Function `supabase/functions/talento-employees`
>   hace lo mismo con la clave guardada en los secretos de Supabase:
>
>   ```bash
>   supabase secrets set TALENTO_API_KEY=PBDFeysVkGLa0zRfq5bYEUtNbmV0akhtN3hFakRES3E2cU82TVE9PQ==
>   supabase functions deploy talento-employees
>   ```
>
>   La app la usa automáticamente al hacer `npm run build` (la URL se deriva de
>   `VITE_SUPABASE_URL`). Opcional: define `VITE_TALENTO_BASE` para forzar otra.

## 4. Build e instalación (PWA)

```bash
npm run build     # genera dist/
npm run preview   # probar el build
```

Sube `dist/` a cualquier hosting estático (Netlify, Vercel, nginx…) con HTTPS. Los usuarios podrán instalarla desde el navegador (Añadir a pantalla de inicio).

## 5. Reglas de negocio implementadas

- No se puede exceder la **capacidad de puestos** del vehículo al seleccionar pasajeros.
- Solo aparecen vehículos `activo` y choferes `active` al crear un viaje.
- Los pasajeros se guardan como **instantánea** (nombre, cargo, departamento) por si la API cambia.
- Un viaje requiere **al menos un destino**, con orden explícito (↑/↓).
- No se eliminan vehículos/choferes con viajes asociados (error 23503); se marcan inactivos.
