-- ============================================================
-- LOGIXLITE - Sucursal opcional en los viajes
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- La sucursal ya no se pide al crear el viaje: el campo pasa
-- a ser opcional. Los viajes antiguos conservan su valor.
-- ============================================================

alter table public.trips
  alter column branch_id drop not null;

-- FIN - esperar: SUCCESS
