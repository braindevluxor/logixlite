-- ============================================================
-- LOGIXLITE - Solicitudes de traslado (link público)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- Personas piden traslado desde /solicitud sin login:
--   - origen fijo (CENTRAL LUXOR)
--   - trabajadores con su cédula y su destino
-- El admin los ve en la pantalla Viajes y los convierte en viaje.
--
-- El público NO toca las tablas: envía todo por la función
-- ride_request_submit (security definer), que valida y
-- normaliza los datos.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tablas
-- ------------------------------------------------------------
create table if not exists public.ride_requests (
  id            bigint generated always as identity primary key,
  contact_phone text,
  notes         text,
  status        text not null default 'pendiente'
                check (status in ('pendiente', 'atendida', 'cancelada')),
  created_at    timestamptz not null default now()
);

create table if not exists public.ride_request_passengers (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.ride_requests (id) on delete cascade,
  full_name   text not null,
  dni         text not null,
  destination text not null,
  phone       text,
  created_at  timestamptz not null default now()
);

-- Compatibilidad con instalaciones que ya crearon la tabla
alter table public.ride_request_passengers
  add column if not exists phone text;

create index if not exists idx_ride_requests_status
  on public.ride_requests (status, created_at desc);

create index if not exists idx_ride_request_passengers_request
  on public.ride_request_passengers (request_id);

-- ------------------------------------------------------------
-- 2. RLS: solo usuarios autenticados (el público entra por la
--    función de abajo, no con lectura/escritura directa)
-- ------------------------------------------------------------
alter table public.ride_requests enable row level security;
alter table public.ride_request_passengers enable row level security;

drop policy if exists "authenticated_all" on public.ride_requests;
create policy "authenticated_all" on public.ride_requests
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.ride_request_passengers;
create policy "authenticated_all" on public.ride_request_passengers
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 3. Envío público: valida, normaliza (mayúsculas) y guarda
-- ------------------------------------------------------------
create or replace function public.ride_request_submit(
  p_phone      text default null,
  p_notes      text default null,
  p_passengers jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_passengers is null or jsonb_array_length(p_passengers) = 0 then
    raise exception 'Agrega al menos un trabajador' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_passengers) x
    where nullif(btrim(coalesce(x ->> 'full_name',   '')), '') is null
       or nullif(btrim(coalesce(x ->> 'dni',         '')), '') is null
       or nullif(btrim(coalesce(x ->> 'destination', '')), '') is null
  ) then
    raise exception 'Cada trabajador necesita nombre, cédula y destino'
      using errcode = '22023';
  end if;

  insert into public.ride_requests (contact_phone, notes)
  values (
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_id;

  insert into public.ride_request_passengers (request_id, full_name, dni, destination, phone)
  select
    v_id,
    upper(btrim(x ->> 'full_name')),
    btrim(x ->> 'dni'),
    upper(btrim(x ->> 'destination')),
    nullif(btrim(coalesce(x ->> 'phone', '')), '')
  from jsonb_array_elements(p_passengers) x;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.ride_request_submit(text, text, jsonb)
  to anon, authenticated;

-- FIN - esperar: SUCCESS
