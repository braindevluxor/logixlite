-- ============================================================
-- LOGIXLITE - Ubicaciones duplicadas por MAYÚSCULAS/minúsculas
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- El unique de locations.name distingue mayúsculas, así que
-- "Terminal" y "TERMINAL" se guardaron como DOS ubicaciones.
--
-- Este script (idempotente):
--   1) elimina los duplicados ignorando mayúsculas, conservando
--      el que tenga enlace de Google Maps y, si ninguno lo
--      tiene, el más antiguo
--   2) pasa todos los nombres del catálogo a MAYÚSCULAS
--   3) crea un índice único sobre lower(name) para que no
--      vuelva a ocurrir (impide cualquier variante de caso)
--   4) normaliza también las paradas de los viajes
--      (trip_destinations) para que el dashboard agrupe bien
--      las paradas y la ruta no tenga nombres mezclados
-- ============================================================

-- ------------------------------------------------------------
-- 1) Quitar duplicados (mismo nombre ignorando mayúsculas y
--    espacios sobrantes)
--    Conserva: primero el que tiene enlace, luego el más antiguo
-- ------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by lower(btrim(name))
           order by (maps_url is not null) desc,
                    created_at asc,
                    id asc
         ) as rn
  from public.locations
)
delete from public.locations l
using ranked r
where l.id = r.id
  and r.rn > 1;

-- ------------------------------------------------------------
-- 2) Catálogo en mayúsculas y sin espacios (regla del sistema)
-- ------------------------------------------------------------
update public.locations
   set name = upper(btrim(name))
 where name <> upper(btrim(name));

-- ------------------------------------------------------------
-- 3) Único ignorando mayúsculas y espacios: "Terminal" y
--    "TERMINAL" ya no podrán convivir (el unique original
--    sigue intacto)
-- ------------------------------------------------------------
create unique index if not exists idx_locations_name_lower
  on public.locations (lower(btrim(name)));

-- ------------------------------------------------------------
-- 4) Paradas de los viajes también en mayúsculas
--    (los viajes viejos quedan consistentes y el gráfico de
--    paradas agrupa bien los nombres)
-- ------------------------------------------------------------
update public.trip_destinations
   set name = upper(name)
 where name <> upper(name);

-- FIN - esperar: SUCCESS
