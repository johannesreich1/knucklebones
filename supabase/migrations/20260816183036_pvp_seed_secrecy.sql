-- Participants must see the CURRENT die but never the seed (knowing the seed
-- reveals every future roll). Seeds live in a service-only side table.
create table public.match_seeds (
  match_id uuid primary key references public.matches(id) on delete cascade,
  seed text not null
);
alter table public.match_seeds enable row level security;  -- no policies: service only
grant all on public.match_seeds to service_role;

insert into public.match_seeds (match_id, seed) select id, seed from public.matches;
alter table public.matches drop column seed;
alter table public.matches add column next_die smallint check (next_die between 1 and 6);;
