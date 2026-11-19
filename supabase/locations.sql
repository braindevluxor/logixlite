-- ============================================================
-- LOGIXLITE - Catálogo de ubicaciones reutilizables
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- Guarda las ubicaciones usadas en los viajes para poder
-- reutilizarlas en próximos viajes (se eligen desde un
-- buscador en el paso 3 del asistente).
-- ============================================================

create table if not exists public.locations (
  id         bigint generated always as identity primary key,
  name       text        not null unique,   -- nombre exacto de la ubicación
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_locations_active_name
  on public.locations (active, name);

alter table public.locations enable row level security;

drop policy if exists "authenticated_all" on public.locations;
create policy "authenticated_all" on public.locations
  for all to authenticated using (true) with check (true);

-- FIN - esperar: SUCCESS
