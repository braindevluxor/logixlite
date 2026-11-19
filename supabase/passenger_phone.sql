-- ============================================================
-- LOGIXLITE - Teléfono del pasajero (instantánea al crear viaje)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- La API de talento humano trae el campo "phone" de cada
-- trabajador; se guarda en el viaje para poder enviarle el
-- aviso directo por WhatsApp (wa.me/<telefono>).
-- ============================================================

alter table public.trip_passengers
  add column if not exists phone text;

-- FIN - esperar: SUCCESS
