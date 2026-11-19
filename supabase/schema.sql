-- ============================================================
-- LOGIXLITE - Esquema Supabase
-- Administración de flota de transporte particular
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- ------------------------------------------------------------
-- 1. SUCURSALES
--    external_id = branchID usado por la API de Talento Humano
-- ------------------------------------------------------------
create table if not exists public.branches (
  id           bigint generated always as identity primary key,
  external_id  bigint       not null unique,   -- branchID de la API
  name         text         not null,
  active       boolean      not null default true,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

comment on table public.branches is 'Sucursales de la empresa (listado sembrado + editable)';

-- ------------------------------------------------------------
-- 2. VEHÍCULOS
-- ------------------------------------------------------------
create table if not exists public.vehicles (
  id           bigint generated always as identity primary key,
  plate        text         not null unique,   -- placa
  brand        text,                           -- marca
  model        text,                           -- modelo
  year         integer,
  capacity     integer      not null check (capacity > 0),  -- puestos
  status       text         not null default 'activo'
                             check (status in ('activo','mantenimiento','inactivo')),
  notes        text,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

comment on column public.vehicles.capacity is 'Cantidad de puestos (asientos)';

-- ------------------------------------------------------------
-- 3. CHOFERES
--    dni se usa para vincular (si existe) con la API de empleados
-- ------------------------------------------------------------
create table if not exists public.drivers (
  id             bigint generated always as identity primary key,
  dni            text         not null unique,
  full_name      text         not null,
  phone          text,
  license_number text,                          -- nº de licencia
  license_expires date,
  active         boolean      not null default true,
  notes          text,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

-- ------------------------------------------------------------
-- 4. VIAJES
-- ------------------------------------------------------------
create table if not exists public.trips (
  id            bigint generated always as identity primary key,
  branch_id     bigint       not null references public.branches (id) on delete restrict,
  vehicle_id    bigint       not null references public.vehicles (id) on delete restrict,
  driver_id     bigint       not null references public.drivers (id) on delete restrict,
  departure_at  timestamptz  not null default now(),
  status        text         not null default 'programado'
                              check (status in ('programado','en_curso','finalizado','cancelado')),
  notes         text,
  track_km      boolean      not null default false,  -- registra KM en cada llegada
  created_by    uuid         references auth.users (id) on delete set null,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);

comment on column public.trips.departure_at is 'Fecha/hora de salida del viaje';

-- ------------------------------------------------------------
-- 5. PASAJEROS DEL VIAJE
--    Se guarda una instantánea del empleado al momento de crear
--    el viaje (la API externa puede cambiar).
-- ------------------------------------------------------------
create table if not exists public.trip_passengers (
  id            bigint generated always as identity primary key,
  trip_id       bigint       not null references public.trips (id) on delete cascade,
  dni           text         not null,
  full_name     text         not null,
  role_name     text,                           -- cargo al momento del viaje
  department    text,                           -- departamento al momento del viaje
  branch_id     bigint,                         -- branchID de origen (API)
  created_at    timestamptz  not null default now(),
  unique (trip_id, dni)
);

-- ------------------------------------------------------------
-- 6. DESTINOS DEL VIAJE (ordenados)
-- ------------------------------------------------------------
create table if not exists public.trip_destinations (
  id            bigint generated always as identity primary key,
  trip_id       bigint       not null references public.trips (id) on delete cascade,
  position      integer      not null,          -- 1, 2, 3 ... orden
  name          text         not null,
  notes         text,
  created_at    timestamptz  not null default now(),
  unique (trip_id, position)
);

-- ------------------------------------------------------------
-- 7. DESTINOS POR PASAJERO (muchos a muchos)
--    Cada pasajero baja en una o varias paradas del viaje
-- ------------------------------------------------------------
create table if not exists public.trip_passenger_destinations (
  id                 bigint generated always as identity primary key,
  trip_passenger_id  bigint not null references public.trip_passengers (id) on delete cascade,
  trip_destination_id bigint not null references public.trip_destinations (id) on delete cascade,
  arrived_at         timestamptz,                      -- hora de llegada
  arrival_note       text,
  latitude           double precision,                 -- GPS
  longitude          double precision,
  gps_accuracy       numeric,                          -- precisión en metros
  km                 numeric,                          -- odómetro al llegar
  created_at         timestamptz not null default now(),
  unique (trip_passenger_id, trip_destination_id)
);

-- ------------------------------------------------------------
-- ÍNDICES
-- ------------------------------------------------------------
create index if not exists idx_trips_branch      on public.trips (branch_id);
create index if not exists idx_trips_vehicle     on public.trips (vehicle_id);
create index if not exists idx_trips_driver      on public.trips (driver_id);
create index if not exists idx_trips_departure   on public.trips (departure_at desc);
create index if not exists idx_trip_passengers   on public.trip_passengers (trip_id);
create index if not exists idx_trip_destinations on public.trip_destinations (trip_id, position);
create index if not exists idx_tpd_passenger     on public.trip_passenger_destinations (trip_passenger_id);
create index if not exists idx_tpd_destination   on public.trip_passenger_destinations (trip_destination_id);

-- Chofer predeterminado por vehículo
alter table public.vehicles
  add column if not exists default_driver_id bigint
  references public.drivers (id) on delete set null;

-- ------------------------------------------------------------
-- Chofer predeterminado por vehículo
-- (también incluido abajo en el ALTER por si el esquema ya existe)
-- ------------------------------------------------------------
alter table public.vehicles
  add column if not exists default_driver_id bigint
  references public.drivers (id) on delete set null;

-- ------------------------------------------------------------
-- updated_at automático
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_branches_updated on public.branches;
create trigger trg_branches_updated
  before update on public.branches
  for each row execute function public.set_updated_at();

drop trigger if exists trg_vehicles_updated on public.vehicles;
create trigger trg_vehicles_updated
  before update on public.vehicles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_drivers_updated on public.drivers;
create trigger trg_drivers_updated
  before update on public.drivers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_trips_updated on public.trips;
create trigger trg_trips_updated
  before update on public.trips
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS: los usuarios autenticados administran la flota
-- ------------------------------------------------------------
alter table public.branches         enable row level security;
alter table public.vehicles         enable row level security;
alter table public.drivers          enable row level security;
alter table public.trips            enable row level security;
alter table public.trip_passengers  enable row level security;
alter table public.trip_destinations enable row level security;
alter table public.trip_passenger_destinations enable row level security;

do $$
declare t text;
begin
  foreach t in array array['branches','vehicles','drivers','trips','trip_passengers','trip_destinations','trip_passenger_destinations']
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
-- DATOS SEMBRADOS: sucursales detectadas en la API
-- (external_id = branchID; la app permite agregar más)
-- ------------------------------------------------------------
insert into public.branches (external_id, name) values
  (5,  'CENTRAL'),
  (6,  'CÍRCULO MILITAR'),
  (7,  'LAS ACACIAS'),
  (8,  'EUROMAXX (SAN DIEGO)'),
  (9,  'EUROMAXX (VILLAS)'),
  (10, 'SAN JUAN'),
  (12, 'EL BOSQUE'),
  (13, 'GUACARA'),
  (14, 'BARQUISIMETO'),
  (15, 'I.P.S.F.A'),
  (16, 'MORA'),
  (17, 'LA VICTORIA'),
  (18, 'NAGUANAGUA'),
  (19, 'SANTA RITA'),
  (20, 'TUCACAS')
on conflict (external_id) do nothing;
