-- ============================================================
-- LOGIXLITE - FUNCIONES COMPLETAS (archivo maestro)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- 100% idempotente: se puede ejecutar las veces que haga
-- falta sin error. Crea/reemplaza TODAS las funciones del
-- sistema de viajes + triggers de protección.
--
-- Si alguno de estos errores aparece, solo indica que esa
-- parte ya existía: todo lo demás se aplica igual.
-- ============================================================

-- ------------------------------------------------------------
-- A. Eliminar versiones antiguas con firmas distintas
--    (evita sobrecarga ambigua en PostgREST)
-- ------------------------------------------------------------
drop function if exists public.trip_share_arrive(uuid, bigint, boolean, text);
drop function if exists public.trip_share_arrive(uuid, bigint, boolean, text, numeric, double precision, double precision, numeric);
drop function if exists public.trip_share_get(uuid);
drop function if exists public.trip_share_start(uuid);
drop function if exists public.trip_share_cancel(uuid, text);
drop function if exists public.trip_share_incident(uuid, bigint, text);

-- ------------------------------------------------------------
-- B. trip_share_get: viaje completo por token
--    (incluye origin_destination_id, GPS, KM, track_km)
-- ------------------------------------------------------------
create function public.trip_share_get(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
begin
  select id into v_trip_id from public.trips where share_token = p_token;
  if v_trip_id is null then
    raise exception 'Token inválido' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'trip', (select to_jsonb(t) from public.trips t where t.id = v_trip_id),
    'branch', (select to_jsonb(b) from public.branches b
               join public.trips tr on tr.branch_id = b.id where tr.id = v_trip_id),
    'vehicle', (select to_jsonb(v) from public.vehicles v
                join public.trips tr on tr.vehicle_id = v.id where tr.id = v_trip_id),
    'driver', (select to_jsonb(d) from public.drivers d
               join public.trips tr on tr.driver_id = d.id where tr.id = v_trip_id),
    'passengers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'dni', p.dni, 'full_name', p.full_name,
        'role_name', p.role_name, 'department', p.department,
        'origin_destination_id', p.origin_destination_id
      ) order by p.full_name), '[]'::jsonb)
      from public.trip_passengers p where p.trip_id = v_trip_id),
    'destinations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'position', d.position, 'name', d.name, 'notes', d.notes
      ) order by d.position), '[]'::jsonb)
      from public.trip_destinations d where d.trip_id = v_trip_id),
    'links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'trip_passenger_id', l.trip_passenger_id,
        'trip_destination_id', l.trip_destination_id,
        'arrived_at', l.arrived_at,
        'arrival_note', l.arrival_note,
        'latitude', l.latitude,
        'longitude', l.longitude,
        'gps_accuracy', l.gps_accuracy,
        'km', l.km
      )), '[]'::jsonb)
      from public.trip_passenger_destinations l
      join public.trip_passengers p on p.id = l.trip_passenger_id
      where p.trip_id = v_trip_id),
    'incidents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'trip_passenger_id', i.trip_passenger_id,
        'message', i.message,
        'created_at', i.created_at
      ) order by i.created_at desc), '[]'::jsonb)
      from public.trip_incidents i where i.trip_id = v_trip_id)
  );
end;
$$;

-- ------------------------------------------------------------
-- C. trip_share_arrive: hora + GPS + KM + auto-estado
--    Valida que el viaje esté iniciado; al 100% lo finaliza.
-- ------------------------------------------------------------
create function public.trip_share_arrive(
  p_token uuid,
  p_link_id bigint,
  p_arrived boolean default true,
  p_note text default null,
  p_km numeric default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_accuracy numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
  v_track_km boolean;
  v_status text;
  v_all_arrived boolean;
  v_row jsonb;
begin
  select id, track_km, status into v_trip_id, v_track_km, v_status
    from public.trips where share_token = p_token;
  if v_trip_id is null then
    raise exception 'Token inválido' using errcode = 'P0002';
  end if;

  if p_arrived then
    if v_status = 'programado' then
      raise exception 'El viaje aún no ha iniciado' using errcode = '22023';
    end if;
    if v_status = 'cancelado' then
      raise exception 'El viaje está cancelado' using errcode = '22023';
    end if;
    if v_track_km and p_km is null then
      raise exception 'Debe indicar el kilometraje del vehículo' using errcode = '22023';
    end if;
    if p_km is not null and p_km < 0 then
      raise exception 'El kilometraje no puede ser negativo' using errcode = '22023';
    end if;
    if p_lat is not null and (p_lat < -90 or p_lat > 90) then
      raise exception 'Latitud fuera de rango' using errcode = '22023';
    end if;
    if p_lon is not null and (p_lon < -180 or p_lon > 180) then
      raise exception 'Longitud fuera de rango' using errcode = '22023';
    end if;
  end if;

  update public.trip_passenger_destinations
     set arrived_at     = case when p_arrived then coalesce(arrived_at, now()) else null end,
         arrival_note   = case when p_arrived then nullif(trim(coalesce(p_note, '')), '') else null end,
         latitude       = case when p_arrived then p_lat else null end,
         longitude      = case when p_arrived then p_lon else null end,
         gps_accuracy   = case when p_arrived then p_accuracy else null end,
         km             = case when p_arrived then p_km else null end
   where id = p_link_id
     and trip_passenger_id in (select id from public.trip_passengers where trip_id = v_trip_id)
  returning jsonb_build_object(
    'id', id,
    'trip_passenger_id', trip_passenger_id,
    'trip_destination_id', trip_destination_id,
    'arrived_at', arrived_at,
    'arrival_note', arrival_note,
    'latitude', latitude,
    'longitude', longitude,
    'gps_accuracy', gps_accuracy,
    'km', km
  ) into v_row;

  if v_row is null then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;

  -- Auto-estado: 100% de llegadas -> finalizado; desmarcar -> en_curso
  select count(*) > 0 and bool_and(l.arrived_at is not null)
    into v_all_arrived
    from public.trip_passenger_destinations l
    join public.trip_passengers p on p.id = l.trip_passenger_id
    where p.trip_id = v_trip_id;

  if p_arrived and v_all_arrived and v_status in ('programado', 'en_curso') then
    update public.trips set status = 'finalizado' where id = v_trip_id;
    v_status := 'finalizado';
  elsif (not p_arrived) and v_status = 'finalizado' then
    update public.trips set status = 'en_curso' where id = v_trip_id;
    v_status := 'en_curso';
  end if;

  v_row := v_row || jsonb_build_object('trip_status', v_status);
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- D. trip_share_start: programado -> en_curso (idempotente)
-- ------------------------------------------------------------
create function public.trip_share_start(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
  v_status text;
begin
  select id, status into v_trip_id, v_status
    from public.trips where share_token = p_token;
  if v_trip_id is null then
    raise exception 'Token inválido' using errcode = 'P0002';
  end if;
  if v_status = 'cancelado' then
    raise exception 'El viaje está cancelado' using errcode = '22023';
  end if;
  if v_status = 'programado' then
    update public.trips set status = 'en_curso' where id = v_trip_id;
    v_status := 'en_curso';
  end if;

  return jsonb_build_object('trip_id', v_trip_id, 'status', v_status);
end;
$$;

-- ------------------------------------------------------------
-- E. trip_share_cancel: cancelar + incidencia (atómico)
-- ------------------------------------------------------------
create function public.trip_share_cancel(
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

-- ------------------------------------------------------------
-- F. trip_share_incident: novedad desde el link del chofer
-- ------------------------------------------------------------
create function public.trip_share_incident(
  p_token uuid,
  p_passenger_id bigint default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
  v_row jsonb;
begin
  select id into v_trip_id from public.trips where share_token = p_token;
  if v_trip_id is null then
    raise exception 'Token inválido' using errcode = 'P0002';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'El mensaje de la novedad es obligatorio' using errcode = '22023';
  end if;
  if p_passenger_id is not null and not exists (
    select 1 from public.trip_passengers where id = p_passenger_id and trip_id = v_trip_id
  ) then
    raise exception 'Pasajero no pertenece a este viaje' using errcode = 'P0002';
  end if;

  insert into public.trip_incidents (trip_id, trip_passenger_id, message)
  values (v_trip_id, p_passenger_id, trim(p_message))
  returning jsonb_build_object(
    'id', id,
    'trip_passenger_id', trip_passenger_id,
    'message', message,
    'created_at', created_at
  ) into v_row;

  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- G. Triggers: los viajes solo se editan en estado programado
-- ------------------------------------------------------------
create or replace function public.trips_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'programado' and old.status <> 'programado' then
    raise exception 'No se puede reprogramar un viaje iniciado' using errcode = '22023';
  end if;

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
-- H. Permisos (el acceso sigue protegido por token)
-- ------------------------------------------------------------
grant execute on function public.trip_share_get(uuid) to anon, authenticated;
grant execute on function public.trip_share_arrive(uuid, bigint, boolean, text, numeric, double precision, double precision, numeric) to anon, authenticated;
grant execute on function public.trip_share_start(uuid) to anon, authenticated;
grant execute on function public.trip_share_cancel(uuid, text) to anon, authenticated;
grant execute on function public.trip_share_incident(uuid, bigint, text) to anon, authenticated;

-- ------------------------------------------------------------
-- I. Recargar el schema cache de PostgREST
--    (por si la función tarda en aparecer)
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- FIN - esperar: "SUCCESS" o "NOTICE" (sin errores rojos)
