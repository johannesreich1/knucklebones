-- The client pages the current ladder by rank. The previous public signature
-- still accepted a season id, while the TypeScript caller sent `from_rank`;
-- PostgREST therefore rejected every paged request before executing SQL. Rank
-- can tie, so nickname is the stable second cursor member and sort key.

drop function if exists public.leaderboard(integer, smallint);
drop function if exists public.leaderboard(integer, smallint, integer);
drop function if exists public.leaderboard(integer, integer);

create function public.leaderboard(
  limit_n integer default 50,
  from_rank integer default 1,
  after_nickname text default null
)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, avatar text, peak integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select board.nickname,
         board.points,
         board.wins,
         board.losses,
         board.games,
         board.rank,
         board.apex,
         board.avatar,
         board.peak
    from private.ladder_board(public.current_season()) board
   where board.rank > greatest(coalesce(from_rank, 1), 1)::bigint
      or (board.rank = greatest(coalesce(from_rank, 1), 1)::bigint
          and (after_nickname is null or board.nickname > after_nickname))
   order by board.rank, board.nickname
   limit least(greatest(coalesce(limit_n, 50), 1), 100);
$function$;

revoke execute on function public.leaderboard(integer, integer, text) from public;
grant execute on function public.leaderboard(integer, integer, text) to anon, authenticated;

-- A separate reverse cursor keeps the public rows in display order while
-- selecting the nearest rows before an anchor. Numeric rank subtraction is
-- not pagination: rank() leaves gaps after ties, including ties larger than a
-- whole client page.
create function public.leaderboard_before(
  limit_n integer,
  before_rank integer,
  before_nickname text
)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, apex boolean, avatar text, peak integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select prior.nickname,
         prior.points,
         prior.wins,
         prior.losses,
         prior.games,
         prior.rank,
         prior.apex,
         prior.avatar,
         prior.peak
    from (
      select board.nickname,
             board.points,
             board.wins,
             board.losses,
             board.games,
             board.rank,
             board.apex,
             board.avatar,
             board.peak
        from private.ladder_board(public.current_season()) board
       where board.rank < greatest(coalesce(before_rank, 1), 1)::bigint
          or (board.rank = greatest(coalesce(before_rank, 1), 1)::bigint
              and board.nickname < coalesce(before_nickname, ''))
       order by board.rank desc, board.nickname desc
       limit least(greatest(coalesce(limit_n, 50), 1), 100)
    ) prior
   order by prior.rank, prior.nickname;
$function$;

revoke execute on function public.leaderboard_before(integer, integer, text) from public;
grant execute on function public.leaderboard_before(integer, integer, text)
  to anon, authenticated;

-- Standing is the caller's projection of that same board. The old function
-- ranked every season row by points alone, including unplayed rows and bots
-- that the visible board may exclude, so its rank could not anchor this API.
create or replace function public.player_standing(p uuid)
returns table(points integer, rank bigint, population bigint, percentile numeric)
language sql
stable
security definer
set search_path = ''
as $function$
  with standing as (
    select board.player,
           board.points,
           board.rank,
           count(*) over () as population,
           percent_rank() over (order by board.points, board.wins)::numeric as percentile
      from private.ladder_board(public.current_season()) board
  )
  select standing.points,
         standing.rank,
         standing.population,
         standing.percentile
    from standing
   where standing.player = p;
$function$;

revoke execute on function public.player_standing(uuid) from public;
grant execute on function public.player_standing(uuid) to anon, authenticated;
