-- A DENSE ORDINAL, so a scroll OFFSET can address a row.
--
-- The ladder is becoming a virtual list: the scrollbar spans the whole board and
-- a drag has to be turned back into a query. `rank` cannot do that job. rank()
-- gaps after ties (20260823113108:53 orders by points desc, wins desc), and
-- 20260823121000's own header already warns that a tie can exceed a whole client
-- page. Worse for a seek: leaderboard_before's cursor is
--   rank < B or (rank = B and nickname < before_nickname)
-- which enters a tie group PART-WAY, so the first row it returns is generally
-- the k-th member of its group and (rank - 1) understates its position by k.
-- That is the function the signed-in ladder OPENS with, so the error is on the
-- first paint, not in a corner. row_number() over the board's own display order
-- is the ordinal a scrollbar is actually measuring.
--
-- The keyset cursors are untouched: sequential paging still sends
-- (rank, nickname) in both directions, and from_pos is an ADDITIONAL entry point
-- used only for a random landing. Nothing here changes which rows a given cursor
-- returns; it only names where they sit.
--
-- population rides along because THE LADDER IS PUBLIC — src/online/screens/ui.ts
-- returns before ensureIdentity(), so a reader has no uuid at all, and
-- player_standing (the only other source of a count) needs one. Without this a
-- signed-out reader could not be given an honest scrollbar.
--
-- private.ladder_board is deliberately NOT touched: pos is computed over its
-- output in the two public functions, so player_standing and player_card keep
-- their signatures and stay out of the blast radius.
--
-- BACKWARD COMPATIBILITY IS REQUIRED. docs/architecture/backend.md mandates
-- database-first rollout, so the currently deployed client must survive this.
-- It sends {limit_n, from_rank, after_nickname}; PostgREST resolves overloads by
-- ARGUMENT NAME, from_pos defaults to null, and the two added result columns are
-- ignored by ladder-api.ts's explicit field mapping. The old 3-argument
-- signatures are dropped explicitly — leaving them would make every existing
-- call ambiguous and PostgREST would answer 300.

drop function if exists public.leaderboard(integer, integer, text);

create function public.leaderboard(
  limit_n integer default 50,
  from_rank integer default 1,
  after_nickname text default null,
  from_pos bigint default null
)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, pos bigint, population bigint,
              apex boolean, avatar text, peak integer)
language sql
stable
security definer
set search_path = ''
as $function$
  with dense as (
    select board.nickname,
           board.points,
           board.wins,
           board.losses,
           board.games,
           board.rank,
           -- the SAME order the RPC returns rows in, so the ordinal and the
           -- display agree by construction rather than by coincidence
           row_number() over (order by board.rank, board.nickname) as pos,
           count(*) over () as population,
           board.apex,
           board.avatar,
           board.peak
      from private.ladder_board(public.current_season()) board
  )
  select dense.nickname,
         dense.points,
         dense.wins,
         dense.losses,
         dense.games,
         dense.rank,
         dense.pos,
         dense.population,
         dense.apex,
         dense.avatar,
         dense.peak
    from dense
   where case
           when from_pos is not null
             then dense.pos >= greatest(from_pos, 1::bigint)
           else dense.rank > greatest(coalesce(from_rank, 1), 1)::bigint
             or (dense.rank = greatest(coalesce(from_rank, 1), 1)::bigint
                 and (after_nickname is null or dense.nickname > after_nickname))
         end
   order by dense.pos
   limit least(greatest(coalesce(limit_n, 50), 1), 100);
$function$;

revoke execute on function public.leaderboard(integer, integer, text, bigint) from public;
grant execute on function public.leaderboard(integer, integer, text, bigint) to anon, authenticated;

-- The reverse cursor reports pos too, so an upward page never has to infer one.
-- It gains no from_pos: a random landing is always forward (leaderboard), and a
-- second seek entry point would be a second way to say the same thing.
drop function if exists public.leaderboard_before(integer, integer, text);

create function public.leaderboard_before(
  limit_n integer,
  before_rank integer,
  before_nickname text
)
returns table(nickname text, points integer, wins bigint, losses bigint, games bigint,
              rank bigint, pos bigint, population bigint,
              apex boolean, avatar text, peak integer)
language sql
stable
security definer
set search_path = ''
as $function$
  with dense as (
    select board.nickname,
           board.points,
           board.wins,
           board.losses,
           board.games,
           board.rank,
           row_number() over (order by board.rank, board.nickname) as pos,
           count(*) over () as population,
           board.apex,
           board.avatar,
           board.peak
      from private.ladder_board(public.current_season()) board
  ),
  prior as (
    -- pos is assigned over the WHOLE board above, so cutting the descending
    -- window here cannot disturb it: the page carries its true positions even
    -- when it starts in the middle of a tied rank, which is the whole point.
    select dense.*
      from dense
     where dense.rank < greatest(coalesce(before_rank, 1), 1)::bigint
        or (dense.rank = greatest(coalesce(before_rank, 1), 1)::bigint
            and dense.nickname < coalesce(before_nickname, ''))
     order by dense.rank desc, dense.nickname desc
     limit least(greatest(coalesce(limit_n, 50), 1), 100)
  )
  select prior.nickname,
         prior.points,
         prior.wins,
         prior.losses,
         prior.games,
         prior.rank,
         prior.pos,
         prior.population,
         prior.apex,
         prior.avatar,
         prior.peak
    from prior
   order by prior.pos;
$function$;

revoke execute on function public.leaderboard_before(integer, integer, text) from public;
grant execute on function public.leaderboard_before(integer, integer, text)
  to anon, authenticated;
