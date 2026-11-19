-- ============================================================
-- LOGIXLITE - Orden de bajada por pasajero
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- Cada pasajero puede tener varias "ubicaciones (baja)".
-- Esta columna guarda el ORDEN en que baja ese pasajero
-- (1 = primera parada donde se baja, 2 = segunda, ...).
-- ============================================================

alter table public.trip_passenger_destinations
  add column if not exists seq integer;

-- Backfill: para viajes existentes usa el orden de la ruta
update public.trip_passenger_destinations l
set seq = d.position
from public.trip_destinations d
where d.id = l.trip_destination_id
  and l.seq is null;

create index if not exists idx_tpd_seq
  on public.trip_passenger_destinations (trip_passenger_id, seq);

-- FIN - esperar: SUCCESS
