-- ============================================================
-- LOGIXLITE - Calificacion del viaje por WhatsApp (link unico)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- (complementa schema.sql y trip_share.sql)
--
-- 1. trip_passengers.rating_token  -> URL publica unica por
--    pasajero en ese viaje: /calificar/<token>
--    (casada al pasajero, de un solo uso)
-- 2. rating / rating_comment / rated_at -> 1 a 5 estrellas y
--    comentario opcional
-- 3. Funciones rating_* -> acceso publico SOLO por token
--    (security definer, mismo patron que trip_share_*)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas de calificacion
-- ------------------------------------------------------------
alter table public.trip_passengers
  add column if not exists rating_token   uuid default gen_random_uuid(),
  add column if not exists rating         integer,
  add column if not exists rating_comment text,
  add column if not exists rated_at       timestamptz;

-- Retrollena los tokens de los pasajeros existentes
update public.trip_passengers
   set rating_token = gen_random_uuid()
 where rating_token is null;

create unique index if not exists idx_trip_passengers_rating_token
  on public.trip_passengers (rating_token);

comment on column public.trip_passengers.rating_token is
  'Token publico y unico del link de calificacion del pasajero en este viaje';
comment on column public.trip_passengers.rating is
  'Estrellas dadas por el pasajero (1 a 5)';

-- ------------------------------------------------------------
-- 2. rating_get: datos del viaje para la pantalla publica
-- ------------------------------------------------------------
create or replace function public.rating_get(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pass public.trip_passengers%rowtype;
  v_trip public.trips%rowtype;
begin
  select * into v_pass
    from public.trip_passengers
   where rating_token = p_token;

  if v_pass.id is null then
    raise exception 'Enlace inválido' using errcode = 'P0002';
  end if;

  select * into v_trip from public.trips where id = v_pass.trip_id;

  return jsonb_build_object(
    'rated', v_pass.rated_at is not null,
    'rating', v_pass.rating,
    'comment', v_pass.rating_comment,
    'passenger_name', v_pass.full_name,
    'trip', jsonb_build_object(
      'id', v_trip.id,
      'departure_at', v_trip.departure_at,
      'status', v_trip.status
    ),
    'driver', (
      select jsonb_build_object('full_name', d.full_name)
        from public.drivers d where d.id = v_trip.driver_id
    ),
    'vehicle', (
      select jsonb_build_object('plate', v.plate)
        from public.vehicles v where v.id = v_trip.vehicle_id
    ),
    'branch', (
      select jsonb_build_object('name', b.name)
        from public.branches b where b.id = v_trip.branch_id
    ),
    'destinations', (
      select coalesce(jsonb_agg(d.name order by d.position), '[]'::jsonb)
        from public.trip_destinations d
       where d.trip_id = v_trip.id
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 3. rating_submit: registra la calificacion (UN SOLO USO)
--    El where "rated_at is null" hace que el segundo intento
--    falle con "Este enlace ya fue usado".
-- ------------------------------------------------------------
create or replace function public.rating_submit(
  p_token uuid,
  p_stars integer,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   bigint;
  v_name text;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'La calificación debe ser de 1 a 5 estrellas'
      using errcode = '22023';
  end if;

  update public.trip_passengers
     set rating = p_stars,
         rating_comment = nullif(btrim(coalesce(p_comment, '')), ''),
         rated_at = now()
   where rating_token = p_token
     and rated_at is null
  returning id, full_name into v_id, v_name;

  if v_id is null then
    if exists (select 1 from public.trip_passengers where rating_token = p_token) then
      raise exception 'Este enlace ya fue usado' using errcode = '22023';
    end if;
    raise exception 'Enlace inválido' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'passenger', v_name,
    'stars', p_stars
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. Permisos de ejecucion (acceso publico por token)
-- ------------------------------------------------------------
grant execute on function public.rating_get(uuid) to anon, authenticated;
grant execute on function public.rating_submit(uuid, integer, text) to anon, authenticated;

-- FIN - esperar: SUCCESS
