-- ============================================================
-- LOGIXLITE - Origen de cada pasajero
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- (complementa schema.sql, trip_share.sql y trip_km.sql)
--
-- Así como cada pasajero tiene sus destinos (dónde baja),
-- ahora también tiene un ORIGEN (dónde sube), elegido entre
-- las paradas ordenadas del viaje.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Origen del pasajero (una sola parada de las del viaje)
--    Se guarda la FK al destino; se elige en el paso 3 del
--    asistente, donde se definen las paradas.
-- ------------------------------------------------------------
alter table public.trip_passengers
  add column if not exists origin_destination_id bigint
  references public.trip_destinations (id) on delete set null;

create index if not exists idx_trip_passengers_origin
  on public.trip_passengers (origin_destination_id);

-- ------------------------------------------------------------
-- 2. trip_share_get: incluir el origen en "passengers"
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

grant execute on function public.trip_share_get(uuid) to anon, authenticated;
