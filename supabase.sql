-- À exécuter une fois dans Supabase > SQL Editor

create table if not exists app_state (
  id int primary key default 1,
  pack_start_date date not null,
  pack_number_in_box int not null default 1,
  missed_dates date[] not null default '{}',
  confirmed_dates date[] not null default '{}',
  push_subscription jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ligne unique (le suivi concerne une seule personne) : à ajuster si besoin avant le premier lancement
insert into app_state (id, pack_start_date, pack_number_in_box)
values (1, current_date, 1)
on conflict (id) do nothing;

-- MIGRATIONS : si ta table app_state existe déjà (installation précédente),
-- lance uniquement les lignes qui te manquent encore.

-- alter table app_state add column if not exists created_at timestamptz not null default now();
-- alter table app_state add column if not exists confirmed_dates date[] not null default '{}';
