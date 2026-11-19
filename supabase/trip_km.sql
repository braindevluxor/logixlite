-- ============================================================
-- LOGIXLITE - Llegada con hora, ubicación GPS y kilometraje
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- (complementa schema.sql y trip_share.sql)
--
-- 1. trips.track_km  → activa el campo KM al crear el viaje
-- 2. En cada llegada se guarda: hora (arrived_at), GPS y KM
-- ============================================================

-- ------------------------------------------------------------
-- 1. Flag de kilometraje por viaje
-- ------------------------------------------------------------
alter table public.trips
  add column if not exists track_km boolean not null default false;

-- ------------------------------------------------------------
-- 2. Detalles de la llegada en cada pasajero ↔ destino
-- ------------------------------------------------------------
alter table public.trip_passenger_destinations
  add column if not exists latitude      double precision,
  add column if not exists longitude     double precision,
  add column if not exists gps_accuracy  numeric,   -- precisión en metros
  add column if not exists km            numeric;   -- odómetro al llegar

-- ------------------------------------------------------------
-- 3. trip_share_get: incluir los nuevos campos en "links"
-- ------------------------------------------------------------
create or replace function public.trip_share_get(p_token uuid)
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
        'role_name', p.role_name, 'department', p.department
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
-- 4. trip_share_arrive: guarda hora + GPS + KM + auto-finaliza
--    (se elimina la versión original de 4 args para evitar
--     sobrecarga; create or replace permite re-ejecutar)
-- ------------------------------------------------------------
drop function if exists public.trip_share_arrive(uuid, bigint, boolean, text);

create or replace function public.trip_share_arrive(
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
    -- Las llegadas solo se marcan después de iniciar el viaje
    if v_status = 'programado' then
      raise exception 'El viaje aún no ha iniciado' using errcode = '22023';
    end if;
    if v_status = 'cancelado' then
      raise exception 'El viaje está cancelado' using errcode = '22023';
    end if;
    -- El KM es obligatorio solo si el viaje lo activó al crearse
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

  -- --------------------------------------------------------
  -- Auto-estado del viaje:
  --  * 100% de llegadas  -> finalizado
  --  * se desmarca una   -> vuelve a en_curso
  -- --------------------------------------------------------
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
-- 5. Iniciar el viaje desde el link del chofer
--    programado -> en_curso (idempotente)
-- ------------------------------------------------------------
create or replace function public.trip_share_start(p_token uuid)
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

grant execute on function public.trip_share_get(uuid) to anon, authenticated;
grant execute on function public.trip_share_arrive(uuid, bigint, boolean, text, numeric, double precision, double precision, numeric) to anon, authenticated;
grant execute on function public.trip_share_incident(uuid, bigint, text) to anon, authenticated;
grant execute on function public.trip_share_start(uuid) to anon, authenticated;
