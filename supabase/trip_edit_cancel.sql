-- ============================================================
-- LOGIXLITE - Edición de viajes + cancelación con incidencia
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- 1. Los viajes solo se editan mientras NO hayan iniciado
--    (programado). Después, los datos quedan bloqueados en BD.
-- 2. trip_share_cancel: el chofer cancela el viaje desde su
--    link y queda registrada la incidencia (motivo).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Protección: no editar datos de un viaje iniciado
--    (el cambio de estado sí está siempre permitido)
-- ------------------------------------------------------------
create or replace function public.trips_guard_update()
returns trigger
language plpgsql
as $$
begin
  -- No volver a 'programado' una vez iniciado
  if new.status = 'programado' and old.status <> 'programado' then
    raise exception 'No se puede reprogramar un viaje iniciado' using errcode = '22023';
  end if;

  -- Si el viaje ya no está programado, bloquear cambios de datos
  if old.status <> 'programado' then
    if new.branch_id   is distinct from old.branch_id
    or new.vehicle_id  is distinct from old.vehicle_id
    or new.driver_id   is distinct from old.driver_id
    or new.departure_at is distinct from old.departure_at
    or new.track_km    is distinct from old.track_km
    or new.notes       is distinct from old.notes then
      raise exception 'Solo se pueden editar viajes que no hayan iniciado'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_trips_guard on public.trips;
create trigger trg_trips_guard
  before update on public.trips
  for each row execute function public.trips_guard_update();

-- ------------------------------------------------------------
-- 2. Protección: pasajeros y destinos solo en viaje programado
--    (DELETE se permite siempre: cubre el borrado en cascada
--     al eliminar el viaje, cuando la fila padre ya no existe)
-- ------------------------------------------------------------
create or replace function public.guard_trip_editable()
returns trigger
language plpgsql
as $$
declare
  v_trip_id bigint;
  v_status text;
begin
  v_trip_id := coalesce(new.trip_id, old.trip_id);
  select status into v_status from public.trips where id = v_trip_id;

  if v_status is not null and v_status <> 'programado' then
    raise exception 'Solo se pueden editar viajes que no hayan iniciado'
      using errcode = '22023';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_pass_insert on public.trip_passengers;
create trigger trg_pass_insert
  before insert on public.trip_passengers
  for each row execute function public.guard_trip_editable();

drop trigger if exists trg_pass_delete on public.trip_passengers;
create trigger trg_pass_delete
  before delete on public.trip_passengers
  for each row execute function public.guard_trip_editable();

drop trigger if exists trg_dest_insert on public.trip_destinations;
create trigger trg_dest_insert
  before insert on public.trip_destinations
  for each row execute function public.guard_trip_editable();

drop trigger if exists trg_dest_delete on public.trip_destinations;
create trigger trg_dest_delete
  before delete on public.trip_destinations
  for each row execute function public.guard_trip_editable();

-- ------------------------------------------------------------
-- 3. Cancelar desde el link del chofer + incidencia
--    (programado o en_curso -> cancelado)
-- ------------------------------------------------------------
create or replace function public.trip_share_cancel(
  p_token uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
  v_status text;
  v_incident jsonb := null;
begin
  select id, status into v_trip_id, v_status
    from public.trips where share_token = p_token;
  if v_trip_id is null then
    raise exception 'Token inválido' using errcode = 'P0002';
  end if;
  if v_status = 'finalizado' then
    raise exception 'El viaje ya finalizó' using errcode = '22023';
  end if;
  if v_status = 'cancelado' then
    return jsonb_build_object('trip_id', v_trip_id, 'status', 'cancelado', 'incident', null);
  end if;

  update public.trips set status = 'cancelado' where id = v_trip_id;

  if p_reason is not null and length(trim(p_reason)) > 0 then
    insert into public.trip_incidents (trip_id, trip_passenger_id, message)
    values (v_trip_id, null, 'Viaje cancelado: ' || trim(p_reason))
    returning jsonb_build_object(
      'id', id,
      'trip_passenger_id', trip_passenger_id,
      'message', message,
      'created_at', created_at
    ) into v_incident;
  end if;

  return jsonb_build_object(
    'trip_id', v_trip_id,
    'status', 'cancelado',
    'incident', v_incident
  );
end;
$$;

grant execute on function public.trip_share_cancel(uuid, text) to anon, authenticated;
