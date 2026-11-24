-- ============================================================
-- LOGIXLITE - Sucursales para las vistas PUBLICAS del chofer
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- La tabla branches tiene RLS (solo usuarios autenticados), asi
-- que la pagina publica del viaje libre no puede leerla para
-- buscar pasajeros en la nomina de trabajadores. Esta funcion
-- expone unicamente las sucursales activas (id, branchID y
-- nombre), que ya se muestran en los links publicos de viaje.
-- ============================================================

create or replace function public.public_branches()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'external_id', b.external_id,
        'name', b.name
      )
      order by b.name
    ),
    '[]'::jsonb
  )
  from public.branches b
  where b.active;
$$;

grant execute on function public.public_branches() to anon, authenticated;

-- FIN - esperar: SUCCESS
