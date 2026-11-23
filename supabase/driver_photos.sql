-- ============================================================
-- LOGIXLITE - Fotos de choferes (Supabase Storage)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
-- (complementa vehicle_photos.sql)
--
-- 1. drivers.photo_path guarda la ruta de la foto en Storage
-- 2. Bucket publico 'driver-photos' (max 5 MB, JPG/PNG/WebP)
-- 3. RLS: lectura publica; escritura solo autenticados
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna en drivers
-- ------------------------------------------------------------
alter table public.drivers
  add column if not exists photo_path text;

-- ------------------------------------------------------------
-- 2. Bucket
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-photos', 'driver-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3. Políticas RLS del bucket
-- ------------------------------------------------------------
drop policy if exists "driver_photos_select" on storage.objects;
create policy "driver_photos_select"
  on storage.objects for select
  using (bucket_id = 'driver-photos');

drop policy if exists "driver_photos_insert" on storage.objects;
create policy "driver_photos_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-photos');

drop policy if exists "driver_photos_update" on storage.objects;
create policy "driver_photos_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'driver-photos');

drop policy if exists "driver_photos_delete" on storage.objects;
create policy "driver_photos_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'driver-photos');

-- FIN - esperar: SUCCESS
