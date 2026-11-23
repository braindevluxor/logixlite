-- ============================================================
-- LOGIXLITE - Registro de combustible (Gasolina / GNV)
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- ------------------------------------------------------------
-- 1. SISTEMA DE COMBUSTIBLE POR VEHÍCULO
--    gasolina = solo carga Lts · gnv = solo carga Vol (gas)
--    ambos    = el vehículo admite los dos registros
-- ------------------------------------------------------------
alter table public.vehicles
  add column if not exists fuel_system text not null default 'ambos';

alter table public.vehicles
  drop constraint if exists vehicles_fuel_system_check;

alter table public.vehicles
  add constraint vehicles_fuel_system_check
  check (fuel_system in ('gasolina', 'gnv', 'ambos'));

comment on column public.vehicles.fuel_system is
  'Sistema de combustible del vehículo: gasolina, gnv (gas) o ambos';

-- ------------------------------------------------------------
-- 2. REGISTROS DE CARGA
--    Se guarda la tasa BCV usada en el momento de la carga:
--    el monto en USD queda congelado aunque la tasa cambie luego.
-- ------------------------------------------------------------
create table if not exists public.fuel_records (
  id             bigint         generated always as identity primary key,
  vehicle_id     bigint         not null references public.vehicles (id) on delete restrict,
  fuel_type      text           not null check (fuel_type in ('gasolina', 'gnv')),
  -- litros (gasolina) o volumen en m3 (GNV)
  quantity       numeric(12, 3) not null check (quantity > 0),
  station        text           not null,
  -- fecha y hora locales de la carga
  fueled_at      timestamptz    not null,
  amount_bs      numeric(14, 2) not null check (amount_bs >= 0),
  -- tasa BCV (Bs por 1 USD) usada al registrar
  rate           numeric(12, 4) not null check (rate > 0),
  -- convertido en el momento: nunca cambia aunque cambie la tasa
  amount_usd     numeric(14, 2) generated always as (round(amount_bs / rate, 2)) stored,
  payment_method text           not null check (payment_method in ('electronico', 'efectivo')),
  -- electronico -> referencia del pago · efectivo -> N° recibo de Logística
  payment_ref    text           not null,
  -- de dónde salió la tasa y su fecha valor
  rate_source    text           not null default 'manual' check (rate_source in ('bcv', 'manual')),
  rate_date      date,
  notes          text,
  created_by     uuid           default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz    not null default now(),
  updated_at     timestamptz    not null default now()
);

comment on table  public.fuel_records is 'Cargas de combustible por vehículo (gasolina en Lts, GNV en Vol)';
comment on column public.fuel_records.quantity is 'Litros (gasolina) o volumen en m3 (GNV)';
comment on column public.fuel_records.amount_usd is 'amount_bs / rate, calculado por la base de datos';

create index if not exists idx_fuel_records_vehicle on public.fuel_records (vehicle_id, fueled_at desc);
create index if not exists idx_fuel_records_fueled   on public.fuel_records (fueled_at desc);

-- ------------------------------------------------------------
-- 3. updated_at automático
-- ------------------------------------------------------------
drop trigger if exists trg_fuel_records_updated on public.fuel_records;
create trigger trg_fuel_records_updated
  before update on public.fuel_records
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 4. RLS: los usuarios autenticados administran la flota
-- ------------------------------------------------------------
alter table public.fuel_records enable row level security;

do $$
begin
  drop policy if exists "authenticated_all" on public.fuel_records;
  create policy "authenticated_all" on public.fuel_records
    for all to authenticated using (true) with check (true);
end;
$$;
