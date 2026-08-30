-- Seasons, and the per-season ladder that replaces the flat profiles.rating.
--
-- Spec: docs/LADDER.md §3 and §6. Additive and invisible: nothing reads these
-- tables until pvp-move v11, so applying this changes nothing a player sees.
--
-- Seasons are mandatory rather than decorative. The new ladder pays a win more
-- than a loss takes, so it inflates forever; the soft reset is the only thing
-- that stops the top group becoming everybody.

create table if not exists public.seasons (
  id          smallint primary key,
  name        text        not null,
  started_at  timestamptz not null default now(),
  -- NULL means "runs endlessly" — Season 1 has no planned end, and a season
  -- only acquires one at the moment somebody decides to roll it over
  ends_at     timestamptz,
  -- how much of a player's points carries into the NEXT season. Half is the
  -- usual compromise: a good player starts ahead, but not so far ahead that a
  -- newcomer can never catch them
  soft_reset  numeric     not null default 0.5
);

create table if not exists public.season_ratings (
  season_id  smallint not null references public.seasons(id) on delete cascade,
  player     uuid     not null references public.profiles(id) on delete cascade,
  points     integer  not null default 0,
  -- the gold notch on the profile ring, and the one value a soft reset carries
  -- forward as a badge
  peak       integer  not null default 0,
  wins       integer  not null default 0,
  losses     integer  not null default 0,
  draws      integer  not null default 0,
  primary key (season_id, player)
);

-- the ladder is read ordered by points within a season, and percentile
-- (0017) scans the same axis
create index if not exists season_ratings_board
  on public.season_ratings (season_id, points desc);

alter table public.matches
  add column if not exists season_id smallint references public.seasons(id);

-- ============ the cutover: retire, do not wipe ============================
-- Everything that already happened moves into a PRE-SEASON. Nothing is
-- deleted: match history keeps working for the players who have any, and the
-- season machinery ships with a real season already behind the current one,
-- which is a better test of it than one season could ever be.
insert into public.seasons (id, name, started_at, ends_at, soft_reset)
values (0, 'Pre-season', '2026-08-16 00:00:00+00', now(), 0)
on conflict (id) do nothing;

insert into public.seasons (id, name, started_at, ends_at, soft_reset)
values (1, 'Season 1', now(), null, 0.5)
on conflict (id) do nothing;

-- every match ever played belongs to the pre-season
update public.matches set season_id = 0 where season_id is null;

-- A match may not span a scale change: it was started under one rating system
-- and would settle under another. At the time of writing the only active
-- matches are abandoned human-vs-bot games idle for hours or days, so they are
-- closed as draws rather than handed to either side.
update public.matches
   set status = 'done', winner = null, finished_at = now(),
       p1_rating_delta = 0, p2_rating_delta = 0, next_die = null
 where status = 'active';

-- Season 1 starts empty and everyone starts at 0. The old ratings are on the
-- old scale and mean nothing under the new one; the profiles.rating mirror is
-- reset with them. It is the only value discarded here, and it is
-- reconstructible from matches.p1_rating_delta / p2_rating_delta.
update public.profiles set rating = 0;

-- ============ seed the bots across the ladder =============================
-- At the switch every profile sits at 0, so percentile is degenerate and a new
-- player's first, tenth and fiftieth opponent would be identical — there would
-- be nothing to climb INTO. The bots are synthetic opponents whose ratings were
-- always hidden, so they are spread across the groups instead: roughly two per
-- group from STONE to the top of OBSIDIAN. Same call migration 0013 already
-- made for the leaderboard — an empty ladder is a worse lie than a populated
-- one — and it gives matchmaking and percentile something real to work with on
-- day one.
--
-- The record that comes with each is deliberately plausible rather than
-- invented from nothing: a bot that has climbed has won more than it lost.
with ladder as (
  select p.id,
         row_number() over (order by p.created_at, p.id) as n,
         count(*)     over ()                            as total
  from public.profiles p
  where p.is_bot = true
),
placed as (
  -- spread evenly across 0 .. 4600 so every group below the apex is occupied
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

-- ============ RLS ==========================================================
-- Seasons are public reference data. Ladder rows are readable by anyone (the
-- leaderboard is public) but writable only by the service role, exactly like
-- profiles.rating — a client that could write its own points would be able to
-- award itself the season.
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
-- The Edge Functions run as service_role, and a table created here grants it
-- NOTHING by default. Without this the ladder is silently read-only-empty:
-- every read comes back with no rows, ladderRow() falls to its 0 default, and
-- two live matches settled 0-vs-0 as though both players were unrated while
-- every write was discarded. RLS is not the mechanism — service_role bypasses
-- that — plain table privileges are. (Applied separately as
-- `season_tables_service_grants`; kept here so a fresh database is correct.)
grant select, insert, update, delete on public.season_ratings to service_role;
grant select, insert, update, delete on public.seasons        to service_role;

-- the current season is the one that has not ended
create or replace function public.current_season()
returns smallint
language sql
stable security definer
set search_path to ''
as $function$
  select id from public.seasons where ends_at is null order by id desc limit 1;
$function$;

revoke execute on function public.current_season() from public;
grant execute on function public.current_season() to anon, authenticated;

-- The mirror must agree with the ladder it mirrors. Seeding the bots above
-- writes season_ratings, but pvp-join reads profiles.rating to pair — leaving
-- it at 0 gave matchmaking a flat pool and made the spread pointless.
-- (Applied separately as `mirror_seeded_bot_points`; kept here so a fresh
-- database built from these migrations lands in the same state.)
update public.profiles p
   set rating = sr.points
  from public.season_ratings sr
 where sr.player = p.id
   and sr.season_id = 1
   and p.rating is distinct from sr.points;
