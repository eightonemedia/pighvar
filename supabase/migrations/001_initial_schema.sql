-- Users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

-- Spots
create table if not exists public.spots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  description text,
  car_access boolean default false,
  fredning_note text,
  sort_order int default 0,
  created_at timestamptz default now()
);

insert into public.spots (name, lat, lng, description, car_access, fredning_note, sort_order) values
  ('Blåvand',    55.5597, 8.0797, 'Blåvandshuk · Revkanten', false, null, 1),
  ('Grærup',     55.6089, 8.1156, 'Hennemølle Å-udløb', false, null, 2),
  ('Henne',      55.6467, 8.1444, 'Henne Å-udløb', false, 'Fredningsbælte ved Henne Å — 2,2 km syd for P-plads, hele året', 3),
  ('Børsmose',   55.6731, 8.1667, 'Børsmose Strand', true, null, 4),
  ('Vejers',     55.6956, 8.1800, 'Vejers Strand', true, null, 5),
  ('Houstrup',   55.7289, 8.1978, 'Houstrup Strand · 300m over klit', false, null, 6),
  ('Nymindegab', 55.8156, 8.2044, 'Fjordudløb · kraftig strøm', false, null, 7);

-- Trips
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  spot_id uuid references public.spots(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  weather_snapshot jsonb,
  distance_m numeric,
  notes text,
  created_at timestamptz default now()
);

-- Catches
create table if not exists public.catches (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id),
  user_id uuid references public.users(id),
  species text not null default 'Pighvar',
  length_cm numeric,
  weight_g numeric,
  lat numeric(9,6),
  lng numeric(9,6),
  photo_url text,
  bait text,
  caught_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Shopping items
create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Andet',
  link text,
  bought boolean default false,
  bought_by_user_id uuid references public.users(id),
  bought_at timestamptz,
  created_at timestamptz default now()
);

-- Spot notes
create table if not exists public.spot_notes (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid references public.spots(id),
  user_id uuid references public.users(id),
  note text not null,
  created_at timestamptz default now()
);

-- RLS — open for now
alter table public.users enable row level security;
alter table public.spots enable row level security;
alter table public.trips enable row level security;
alter table public.catches enable row level security;
alter table public.shopping_items enable row level security;
alter table public.spot_notes enable row level security;

create policy "allow all" on public.users for all using (true);
create policy "allow all" on public.spots for all using (true);
create policy "allow all" on public.trips for all using (true);
create policy "allow all" on public.catches for all using (true);
create policy "allow all" on public.shopping_items for all using (true);
create policy "allow all" on public.spot_notes for all using (true);
