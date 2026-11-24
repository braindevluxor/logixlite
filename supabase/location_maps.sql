-- ============================================================
-- LOGIXLITE - Enlace de Google Maps por ubicacion
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- Guarda el enlace de Google Maps (direccion o punto exacto)
-- que se coloca al crear un destino/origen, para que el mapa
-- de la ruta use las coordenadas exactas en vez de buscar el
-- nombre a ciegas.
--
-- 1. locations.maps_url          -> dato en el catalogo
--    (reutilizable en proximos viajes)
-- 2. trip_destinations.maps_url  -> copia en la parada del
--    viaje (las dos columnas son opcionales)
-- ============================================================

alter table public.locations
  add column if not exists maps_url text;

alter table public.trip_destinations
  add column if not exists maps_url text;

comment on column public.locations.maps_url is
  'Enlace de Google Maps de la ubicacion (opcional)';
comment on column public.trip_destinations.maps_url is
  'Enlace de Google Maps copiado del catalogo al crear la parada';

-- FIN - esperar: SUCCESS
