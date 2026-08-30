create table if not exists public.seasons (
  id          smallint primary key,
  name        text        not null,
  started_at  timestamptz not null default now(),
  ends_at     timestamptz,
  soft_reset  numeric     not null default 0.5
);

create table if not exists public.season_ratings (
  season_id  smallint not null references public.seasons(id) on delete cascade,
  player     uuid     not null references public.profiles(id) on delete cascade,
  points     integer  not null default 0,
  peak       integer  not null default 0,
  wins       integer  not null default 0,
  losses     integer  not null default 0,
  draws      integer  not null default 0,
  primary key (season_id, player)
);

create index if not exists season_ratings_board
  on public.season_ratings (season_id, points desc);

alter table public.matches
  add column if not exists season_id smallint references public.seasons(id);

insert into public.seasons (id, name, started_at, ends_at, soft_reset)
values (0, 'Pre-season', '2026-08-16 00:00:00+00', now(), 0)
on conflict (id) do nothing;

insert into public.seasons (id, name, started_at, ends_at, soft_reset)
values (1, 'Season 1', now(), null, 0.5)
on conflict (id) do nothing;

update public.matches set season_id = 0 where season_id is null;

update public.matches
   set status = 'done', winner = null, finished_at = now(),
       p1_rating_delta = 0, p2_rating_delta = 0, next_die = null
 where status = 'active';

update public.profiles set rating = 0;

with ladder as (
  select p.id,
         row_number() over (order by p.created_at, p.id) as n,
         count(*)     over ()                            as total
  from public.profiles p
  where p.is_bot = true
),
placed as (
  select id, (round(((n - 1)::numeric / greatest(total - 1, 1)) * 4600 / 10) * 10)::integer as points
  from ladder
)
insert into public.season_ratings (season_id, player, points, peak, wins, losses, draws)
select 1, id, points, points,
       greatest(3, (points / 260)::integer + 3),
       greatest(2, (points / 420)::integer + 2),
       0
from placed
on conflict (season_id, player) do nothing;

alter table public.seasons        enable row level security;
alter table public.season_ratings enable row level security;

drop policy if exists seasons_read on public.seasons;
create policy seasons_read on public.seasons for select to anon, authenticated using (true);

drop policy if exists season_ratings_read on public.season_ratings;
create policy season_ratings_read on public.season_ratings
  for select to anon, authenticated using (true);

revoke all on public.seasons        from anon, authenticated;
revoke all on public.season_ratings from anon, authenticated;
grant select on public.seasons        to anon, authenticated;
grant select on public.season_ratings to anon, authenticated;

create or replace function public.current_season()
returns smallint
language sql
stable security definer
set search_path to ''
as $function$
  select id from public.seasons where ends_at is null order by id desc limit 1;
$function$;

revoke execute on function public.current_season() from public;
grant execute on function public.current_season() to anon, authenticated;;
