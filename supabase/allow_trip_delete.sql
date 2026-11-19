-- ============================================================
-- LOGIXLITE - Permitir eliminar viajes (cualquier estado)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- El guard de edición bloqueaba el borrado en cascada de
-- pasajeros/destinos cuando el viaje no estaba "programado".
-- Ahora se permite cuando el borrado viene de eliminar el
-- viaje completo (trigger RI de PostgreSQL, profundidad > 1),
-- manteniendo la protección contra ediciones directas.
-- ============================================================

create or replace function public.guard_trip_editable()
returns trigger
language plpgsql
as $$
declare
  v_trip_id bigint;
  v_status text;
begin
  -- Borrado en cascada al eliminar el viaje completo:
  -- ocurre DENTRO del trigger RI de PostgreSQL (profundidad > 1)
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  v_trip_id := coalesce(new.trip_id, old.trip_id);
  select status into v_status from public.trips where id = v_trip_id;

  -- Si el viaje ya no existe (también cascada) o sigue programado: permitir
  if v_status is not null and v_status <> 'programado' then
    raise exception 'Solo se pueden editar viajes que no hayan iniciado'
      using errcode = '22023';
  end if;

  return coalesce(new, old);
end;
$$;

-- FIN - esperar: SUCCESS
-- (los triggers existentes ya usan esta función; el reemplazo aplica solo)
