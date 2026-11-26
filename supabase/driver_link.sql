-- ============================================================
-- LOGIXLITE - Link publico por chofer + Viaje libre
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- (complementa schema.sql y trip_share.sql)
--
-- 1. drivers.link_token  -> URL secreta de cada chofer:
--       /chofer/<token>          menu principal
--       /chofer/<token>/libre    viaje libre
-- 2. Tablas free_trips / free_trip_passengers / free_trip_stops
--    -> el chofer registra a quien lleva y las paradas que
--       va haciendo en un viaje libre
-- 3. Funciones driver_*  -> acceso publico SOLO por token
--    (security definer, mismas garantias que trip_share_*)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Token publico por chofer
-- ------------------------------------------------------------
alter table public.drivers
  add column if not exists link_token uuid default gen_random_uuid();

update public.drivers
   set link_token = gen_random_uuid()
 where link_token is null;

create unique index if not exists idx_drivers_link_token
  on public.drivers (link_token);

comment on column public.drivers.link_token is
  'Token del link publico del chofer (/chofer/<token>)';

-- ------------------------------------------------------------
-- 2. VIAJE LIBRE
--    El chofer declara quienes van con el y las paradas
--    que hace durante el recorrido.
-- ------------------------------------------------------------
create table if not exists public.free_trips (
  id           bigint generated always as identity primary key,
  driver_id    bigint      not null references public.drivers (id) on delete cascade,
  status       text        not null default 'en_curso'
                           check (status in ('en_curso','finalizado')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);

comment on table public.free_trips is
  'Viaje libre iniciado por el chofer desde su link publico';

create table if not exists public.free_trip_passengers (
  id            bigint generated always as identity primary key,
  free_trip_id  bigint      not null references public.free_trips (id) on delete cascade,
  full_name     text        not null,
  dni           text,
  phone         text,
  seq           integer     not null default 1,
  created_at    timestamptz not null default now()
);

create table if not exists public.free_trip_stops (
  id            bigint generated always as identity primary key,
  free_trip_id  bigint      not null references public.free_trips (id) on delete cascade,
  name          text        not null,
  note          text,
  arrived_at    timestamptz not null default now(),
  seq           integer     not null default 1,
  created_at    timestamptz not null default now()
);

create index if not exists idx_free_trips_driver
  on public.free_trips (driver_id, status);
create index if not exists idx_free_trip_passengers
  on public.free_trip_passengers (free_trip_id, seq);
create index if not exists idx_free_trip_stops
  on public.free_trip_stops (free_trip_id, seq);

-- ------------------------------------------------------------
-- 3. RLS: sin politicas propias para anon (solo se accede por
--    las funciones driver_* con token); los usuarios
--    autenticados pueden leer/escribir como el resto
-- ------------------------------------------------------------
alter table public.free_trips             enable row level security;
alter table public.free_trip_passengers   enable row level security;
alter table public.free_trip_stops        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['free_trips','free_trip_passengers','free_trip_stops']
  loop
    execute format('drop policy if exists "authenticated_all" on public.%I', t);
    execute format(
      'create policy "authenticated_all" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 4. driver_link_get: datos del menu del chofer
--    (viajes pendientes + viaje libre activo con sus
--     pasajeros y paradas)
-- ------------------------------------------------------------
create or replace function public.driver_link_get(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver public.drivers%rowtype;
begin
  select * into v_driver from public.drivers where link_token = p_token;
  if v_driver.id is null then
    raise exception 'Enlace inválido' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'driver', jsonb_build_object(
      'id', v_driver.id,
      'full_name', v_driver.full_name,
      'dni', v_driver.dni,
      'phone', v_driver.phone,
      'active', v_driver.active
    ),
    'trips', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id,
        'status', t.status,
        'departure_at', t.departure_at,
        'share_token', t.share_token,
        'notes', t.notes,
        'track_km', t.track_km,
        'branch', b.name,
        'vehicle', v.plate,
        'passengers', (select count(*) from public.trip_passengers p where p.trip_id = t.id),
        'destinations', (
          select coalesce(jsonb_agg(d.name order by d.position), '[]'::jsonb)
            from public.trip_destinations d where d.trip_id = t.id)
      ) order by t.departure_at), '[]'::jsonb)
      from public.trips t
      left join public.branches b on b.id = t.branch_id
      left join public.vehicles  v on v.id = t.vehicle_id
      where t.driver_id = v_driver.id
        and t.status in ('programado','en_curso')
    ),
    'free_trip', (
      select jsonb_build_object(
        'id', ft.id,
        'status', ft.status,
        'started_at', ft.started_at,
        'finished_at', ft.finished_at,
        'passengers', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', fp.id, 'full_name', fp.full_name, 'dni', fp.dni,
            'phone', fp.phone, 'seq', fp.seq
          ) order by fp.seq, fp.id), '[]'::jsonb)
          from public.free_trip_passengers fp where fp.free_trip_id = ft.id),
        'stops', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', fs.id, 'name', fs.name, 'note', fs.note,
            'arrived_at', fs.arrived_at, 'seq', fs.seq
          ) order by fs.seq, fs.id), '[]'::jsonb)
          from public.free_trip_stops fs where fs.free_trip_id = ft.id)
      )
      from public.free_trips ft
      where ft.driver_id = v_driver.id
        and ft.status = 'en_curso'
      order by ft.started_at desc
      limit 1
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 5. Iniciar viaje libre (idempotente: si ya hay uno activo
--    devuelve ese)
-- ------------------------------------------------------------
create or replace function public.driver_free_start(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver_id bigint;
  v_id        bigint;
begin
  select id into v_driver_id from public.drivers where link_token = p_token;
  if v_driver_id is null then
    raise exception 'Enlace inválido' using errcode = 'P0002';
  end if;

  select id into v_id
    from public.free_trips
   where driver_id = v_driver_id
     and status = 'en_curso'
   order by started_at desc
   limit 1;

  if v_id is null then
    insert into public.free_trips (driver_id)
    values (v_driver_id)
    returning id into v_id;
  end if;

  return (select jsonb_build_object(
      'id', id, 'status', status, 'started_at', started_at
    ) from public.free_trips where id = v_id);
end;
$$;

-- ------------------------------------------------------------
-- 6. Agregar pasajero al viaje libre
-- ------------------------------------------------------------
create or replace function public.driver_free_add_passenger(
  p_token uuid,
  p_name  text,
  p_dni   text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
  v_name    text;
  v_id      bigint;
  v_dni     text;
  v_phone   text;
  v_seq     integer;
begin
  select ft.id into v_trip_id
    from public.free_trips ft
    join public.drivers d on d.id = ft.driver_id
   where d.link_token = p_token
     and ft.status = 'en_curso'
   order by ft.started_at desc
   limit 1;
  if v_trip_id is null then
    raise exception 'No hay un viaje libre activo' using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'Indica el nombre del pasajero' using errcode = '22023';
  end if;

  -- INSERT ... RETURNING ... INTO: un CTE con INSERT debe estar
  -- en el nivel superior de la sentencia (no dentro de otra
  -- subconsulta), por eso no se usa "with ins as (insert ...)"
  insert into public.free_trip_passengers
    (free_trip_id, full_name, dni, phone, seq)
  values (
    v_trip_id,
    v_name,
    nullif(btrim(coalesce(p_dni,   '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    coalesce((select max(seq) from public.free_trip_passengers
               where free_trip_id = v_trip_id), 0) + 1
  )
  returning id, full_name, dni, phone, seq
  into v_id, v_name, v_dni, v_phone, v_seq;

  return jsonb_build_object(
    'id', v_id, 'full_name', v_name, 'dni', v_dni,
    'phone', v_phone, 'seq', v_seq
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. Quitar pasajero del viaje libre
-- ------------------------------------------------------------
create or replace function public.driver_free_remove_passenger(
  p_token uuid,
  p_passenger_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.free_trip_passengers
   where id = p_passenger_id
     and free_trip_id in (
       select ft.id from public.free_trips ft
       join public.drivers d on d.id = ft.driver_id
       where d.link_token = p_token and ft.status = 'en_curso');
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- ------------------------------------------------------------
-- 8. Registrar parada del viaje libre (llegada)
-- ------------------------------------------------------------
create or replace function public.driver_free_add_stop(
  p_token uuid,
  p_name  text,
  p_note  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
  v_name    text;
  v_id      bigint;
  v_note    text;
  v_arrived timestamptz;
  v_seq     integer;
begin
  select ft.id into v_trip_id
    from public.free_trips ft
    join public.drivers d on d.id = ft.driver_id
   where d.link_token = p_token
     and ft.status = 'en_curso'
   order by ft.started_at desc
   limit 1;
  if v_trip_id is null then
    raise exception 'No hay un viaje libre activo' using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'Indica la parada' using errcode = '22023';
  end if;

  -- INSERT ... RETURNING ... INTO: un CTE con INSERT debe estar
  -- en el nivel superior de la sentencia (no dentro de otra
  -- subconsulta), por eso no se usa "with ins as (insert ...)"
  insert into public.free_trip_stops
    (free_trip_id, name, note, seq)
  values (
    v_trip_id,
    v_name,
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce((select max(seq) from public.free_trip_stops
               where free_trip_id = v_trip_id), 0) + 1
  )
  returning id, name, note, arrived_at, seq
  into v_id, v_name, v_note, v_arrived, v_seq;

  return jsonb_build_object(
    'id', v_id, 'name', v_name, 'note', v_note,
    'arrived_at', v_arrived, 'seq', v_seq
  );
end;
$$;

-- ------------------------------------------------------------
-- 9. Quitar parada del viaje libre
-- ------------------------------------------------------------
create or replace function public.driver_free_remove_stop(
  p_token uuid,
  p_stop_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.free_trip_stops
   where id = p_stop_id
     and free_trip_id in (
       select ft.id from public.free_trips ft
       join public.drivers d on d.id = ft.driver_id
       where d.link_token = p_token and ft.status = 'en_curso');
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- ------------------------------------------------------------
-- 10. Finalizar viaje libre
-- ------------------------------------------------------------
create or replace function public.driver_free_finish(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip_id bigint;
begin
  select ft.id into v_trip_id
    from public.free_trips ft
    join public.drivers d on d.id = ft.driver_id
   where d.link_token = p_token
     and ft.status = 'en_curso'
   order by ft.started_at desc
   limit 1;
  if v_trip_id is null then
    raise exception 'No hay un viaje libre activo' using errcode = '22023';
  end if;

  update public.free_trips
     set status = 'finalizado', finished_at = now()
   where id = v_trip_id;

  return (select jsonb_build_object(
      'id', ft.id,
      'status', ft.status,
      'started_at', ft.started_at,
      'finished_at', ft.finished_at,
      'passengers', (select count(*) from public.free_trip_passengers
                      where free_trip_id = ft.id),
      'stops', (select count(*) from public.free_trip_stops
                 where free_trip_id = ft.id)
    ) from public.free_trips ft where ft.id = v_trip_id);
end;
$$;

-- ------------------------------------------------------------
-- 11. Permisos de ejecucion (acceso publico por token)
-- ------------------------------------------------------------
grant execute on function public.driver_link_get(uuid) to anon, authenticated;
grant execute on function public.driver_free_start(uuid) to anon, authenticated;
grant execute on function public.driver_free_add_passenger(uuid, text, text, text) to anon, authenticated;
grant execute on function public.driver_free_remove_passenger(uuid, bigint) to anon, authenticated;
grant execute on function public.driver_free_add_stop(uuid, text, text) to anon, authenticated;
grant execute on function public.driver_free_remove_stop(uuid, bigint) to anon, authenticated;
grant execute on function public.driver_free_finish(uuid) to anon, authenticated;

-- FIN - esperar: SUCCESS
