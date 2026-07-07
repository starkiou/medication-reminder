-- À exécuter une fois dans Supabase > SQL Editor

create table if not exists app_state (
  id int primary key default 1,
  pack_start_date date not null,
  pack_number_in_box int not null default 1,
  missed_dates date[] not null default '{}',
  push_subscription jsonb,
  updated_at timestamptz not null default now()
);

-- Ligne unique (une seule personne) : à ajuster si besoin avant le premier lancement
insert into app_state (id, pack_start_date, pack_number_in_box)
values (1, current_date, 1)
on conflict (id) do nothing;
