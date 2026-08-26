-- Seeded ladder opponents need a believable historical best streak without
-- inventing match rows. Keep that imported lower bound beside, rather than in,
-- season_ratings: authoritative settlement compares the complete rating row
-- against the five-field Edge snapshot, so widening that row would break every
-- ranked compare-and-set.

begin;

create table private.season_streak_baselines (
  season_id smallint not null,
  player uuid not null,
  best_streak integer not null,
  constraint season_streak_baselines_pkey
    primary key (season_id, player),
  constraint season_streak_baselines_rating_fkey
    foreign key (season_id, player)
    references public.season_ratings (season_id, player)
    on delete cascade,
  constraint season_streak_baselines_best_streak_check
    check (best_streak >= 0)
);

comment on table private.season_streak_baselines is
  'Imported per-season lower bound for the displayed best streak; absence means zero and no match history is implied.';

revoke all on table private.season_streak_baselines
  from public, anon, authenticated, service_role;

-- Keep the public player-card signature and disclosure boundary unchanged.
-- A real current-season run supersedes the imported baseline as soon as it is
-- longer; best_streak() already delegates to this function.
create or replace function public.player_card(nick text)
returns table(streak integer, since timestamptz, points integer,
              wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, peak integer)
language sql
stable
security definer
set search_path = ''
as $function$
  with who as (
    select id, created_at
      from public.profiles
     where nickname = nick
     limit 1
  ),
  played as (
    select (m.winner = (select id from who)) as won,
           row_number() over (order by m.finished_at, m.id) as n
      from public.matches m
     where (m.p1 = (select id from who) or m.p2 = (select id from who))
       and m.status <> 'active'
       and m.season_id = public.current_season()
  ),
  runs as (
    select won, n - row_number() over (partition by won order by n) as grp
      from played
  ),
  baseline as (
    select stored.best_streak
      from private.season_streak_baselines stored
     where stored.season_id = public.current_season()
       and stored.player = (select id from who)
  ),
  mine as (
    select *
      from private.ladder_board(public.current_season())
     where player = (select id from who)
  )
  select greatest(
           coalesce((select count(*)::integer
                       from runs
                      where won
                      group by grp
                      order by count(*) desc
                      limit 1), 0),
           coalesce((select best_streak from baseline), 0)
         ),
         (select created_at from who),
         (select mine.points from mine),
         (select mine.wins from mine),
         (select mine.losses from mine),
         (select mine.games from mine),
         (select mine.rank from mine),
         (select mine.apex from mine),
         (select mine.peak from mine);
$function$;

revoke execute on function public.player_card(text) from public;
grant execute on function public.player_card(text) to anon, authenticated;

commit;
