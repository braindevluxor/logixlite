-- ============================================================
-- LOGIXLITE - Normaliza nombres de departamento históricos
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- Los viajes viejos guardaron el departamento con nombres que
-- la API ya no usa (ej. "EQUIPO TI"), así el dashboard los
-- mostraba como un segmento separado de "TECNICO_TI".
--
-- Este script unifica los datos existentes. Si la API vuelve a
-- cambiar un nombre, agregar el alias aquí y también en
-- src/lib/departments.ts (DEPT_ALIASES) para los viajes nuevos.
-- ============================================================

with alias (old_name, new_name) as (
  values
    ('EQUIPO TI', 'TECNICO_TI')
)
update public.trip_passengers p
   set department = a.new_name
  from alias a
 where p.department is not null
   and upper(btrim(p.department)) = a.old_name;

-- FIN - esperar: SUCCESS (o UPDATE n)
