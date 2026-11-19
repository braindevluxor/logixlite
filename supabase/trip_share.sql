-- ============================================================
-- LOGIXLITE - Link de seguimiento para el chofer
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- (complementa supabase/schema.sql)
--
-- El chofer abre un link con un token secreto (uuid) y puede:
--   1. Marcar la llegada de cada pasajero a su destino
--   2. Reportar novedades (generales o de un pasajero)
-- No necesita cuenta ni contraseña: el token da acceso solo a ese viaje.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Token público por viaje
-- ------------------------------------------------------------
alter table public.trips
  add column if not exists share_token uuid default gen_random_uuid();

update public.trips set share_token = gen_random_uuid() where share_token is null;

create unique index if not exists idx_trips_share_token
  on public.trips (share_token);

-- ------------------------------------------------------------
-- 2. Estado de llegada por pasajero ↔ destino
-- ------------------------------------------------------------
alter table public.trip_passenger_destinations
  add column if not exists arrived_at timestamptz,
  add column if not exists arrival_note text;

-- ------------------------------------------------------------
-- 3. Novedades reportadas por el chofer
-- ------------------------------------------------------------
create table if not exists public.trip_incidents (
  id                 bigint generated always as identity primary key,
  trip_id            bigint not null references public.trips (id) on delete cascade,
  trip_passenger_id  bigint references public.trip_passengers (id) on delete set null,
  message            text   not null check (length(trim(message)) > 0),
  created_at         timestamptz not null default now()
);

create index if not exists idx_trip_incidents_trip
  on public.trip_incidents (trip_id, created_at desc);

alter table public.trip_incidents enable row level security;

drop policy if exists "authenticated_all" on public.trip_incidents;
create policy "authenticated_all" on public.trip_incidents
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 4. Funciones con acceso por token (security definer)
--    Validan el token en cada llamada; no exponen otras tablas.
-- ------------------------------------------------------------

-- 4a. Leer el viaje completo (chofer)
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
        'arrival_note', l.arrival_note
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

-- 4b. Marcar / desmarcar llegada a un destino (chofer)
create or replace function public.trip_share_arrive(
  p_token uuid,
  p_link_id bigint,
  p_arrived boolean default true,
  p_note text default null
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

  update public.trip_passenger_destinations
     set arrived_at = case when p_arrived then coalesce(arrived_at, now()) else null end,
         arrival_note = case when p_arrived then nullif(trim(coalesce(p_note, '')), '') else null end
   where id = p_link_id
     and trip_passenger_id in (select id from public.trip_passengers where trip_id = v_trip_id)
  returning jsonb_build_object(
    'id', id,
    'trip_passenger_id', trip_passenger_id,
    'trip_destination_id', trip_destination_id,
    'arrived_at', arrived_at,
    'arrival_note', arrival_note
  ) into v_row;

  if v_row is null then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- 4c. Reportar novedad (chofer)
create or replace function public.trip_share_incident(
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
-- 5. Permisos de ejecución (el acceso sigue protegido por token)
-- ------------------------------------------------------------
grant execute on function public.trip_share_get(uuid) to anon, authenticated;
grant execute on function public.trip_share_arrive(uuid, bigint, boolean, text) to anon, authenticated;
grant execute on function public.trip_share_incident(uuid, bigint, text) to anon, authenticated;
