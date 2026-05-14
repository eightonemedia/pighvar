insert into public.spots (name, lat, lng, description, car_access, fredning_note, sort_order) values
  ('Lyngvig',   55.9089, 8.2133, 'Lyngvig Strand · syd for Hvide Sande · god sandbund · 10-15 min gang over klit fra P-plads — besværlig adgang', false, null, 8),
  ('Søndervig', 56.0156, 8.2044, 'Søndervig Strand · nord for Hvide Sande · god pighvarstand men mindre stabil end sydlige spots — bil tilladt på strand men lang kørsel fra kernestræk', true, null, 9);

create table if not exists public.spot_features (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid references public.spots(id) on delete cascade,
  user_id uuid references public.users(id),
  type text not null check (type in ('hestehul', 'revle', 'prel', 'aaudlob', 'andet')),
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  note text,
  date_found date default current_date,
  active boolean default true,
  created_at timestamptz default now()
);

alter table public.spot_features enable row level security;
create policy "allow all" on public.spot_features for all using (true);
