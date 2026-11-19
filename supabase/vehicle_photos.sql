-- ============================================================
-- LOGIXLITE - Fotos de vehículos (Supabase Storage)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- 1. vehicles.photo_path guarda la ruta de la foto en Storage
-- 2. Bucket público 'vehicle-photos' (máx 5 MB, JPG/PNG/WebP)
-- 3. RLS: lectura pública; escritura solo autenticados
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna en vehicles
-- ------------------------------------------------------------
alter table public.vehicles
  add column if not exists photo_path text;

-- ------------------------------------------------------------
-- 2. Bucket
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3. Políticas RLS del bucket
-- ------------------------------------------------------------
drop policy if exists "vehicle_photos_select" on storage.objects;
create policy "vehicle_photos_select"
  on storage.objects for select
  using (bucket_id = 'vehicle-photos');

drop policy if exists "vehicle_photos_insert" on storage.objects;
create policy "vehicle_photos_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos');

drop policy if exists "vehicle_photos_update" on storage.objects;
create policy "vehicle_photos_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-photos');

drop policy if exists "vehicle_photos_delete" on storage.objects;
create policy "vehicle_photos_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-photos');

-- FIN - esperar: SUCCESS
