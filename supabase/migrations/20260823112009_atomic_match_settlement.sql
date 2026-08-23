-- One atomic persistence boundary for every terminal match path.
--
-- TypeScript remains the sole owner of ladder arithmetic (`core/ladder.ts`).
-- The database receives the rows that arithmetic read and the rows it
-- produced, then atomically verifies/commits them with the match outcome. A
-- stale expected row raises a serialization failure so the caller can reload
-- and recompute; a match already claimed by another finisher is returned
-- unchanged and is never paid twice.

create index if not exists season_ratings_player_idx
  on public.season_ratings (player);

create or replace function public.settle_match(
  p_match_id uuid,
  p_status text,
  p_winner uuid,
  p_p1_score integer,
  p_p2_score integer,
  p_p1_delta integer,
  p_p2_delta integer,
  p_expected_p1 jsonb,
  p_expected_p2 jsonb,
  p_next_p1 jsonb,
  p_next_p2 jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_p1 public.season_ratings%rowtype;
  v_p2 public.season_ratings%rowtype;
  v_season smallint;
  v_rows integer;
begin
  if p_status not in ('done', 'forfeit') then
    raise exception 'invalid terminal match status: %', p_status
      using errcode = '22023';
  end if;
  if p_p1_score < 0 or p_p2_score < 0 then
    raise exception 'match scores must be non-negative'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_expected_p1) <> 'object'
     or jsonb_typeof(p_expected_p2) <> 'object'
     or jsonb_typeof(p_next_p1) <> 'object'
     or jsonb_typeof(p_next_p2) <> 'object' then
    raise exception 'ladder snapshots must be JSON objects'
      using errcode = '22023';
  end if;

  -- Lock the match first. Racing finishers serialize here; only the caller
  -- that observes `active` continues to the ladder locks and payout.
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match % does not exist', p_match_id
      using errcode = 'P0002';
  end if;
  if v_match.status <> 'active' then
    return jsonb_build_object('applied', false, 'match', to_jsonb(v_match));
  end if;
  if p_winner is not null and p_winner <> v_match.p1 and p_winner <> v_match.p2 then
    raise exception 'winner is not a match participant'
      using errcode = '22023';
  end if;

  v_season := coalesce(v_match.season_id, 1);
  insert into public.season_ratings (season_id, player)
  values (v_season, v_match.p1), (v_season, v_match.p2)
  on conflict (season_id, player) do nothing;

  -- UUID order gives every concurrent settlement the same lock order.
  perform player
    from public.season_ratings
   where season_id = v_season
     and player in (v_match.p1, v_match.p2)
   order by player
   for update;

  select * into strict v_p1
    from public.season_ratings
   where season_id = v_season and player = v_match.p1;
  select * into strict v_p2
    from public.season_ratings
   where season_id = v_season and player = v_match.p2;

  if (to_jsonb(v_p1) - 'season_id' - 'player') is distinct from p_expected_p1
     or (to_jsonb(v_p2) - 'season_id' - 'player') is distinct from p_expected_p2 then
    raise exception 'ladder changed while match % was settling', p_match_id
      using errcode = '40001';
  end if;

  update public.matches
     set status = p_status,
         winner = p_winner,
         p1_score = p_p1_score,
         p2_score = p_p2_score,
         p1_rating_delta = p_p1_delta,
         p2_rating_delta = p_p2_delta,
         next_die = null,
         finished_at = clock_timestamp(),
         last_move_at = clock_timestamp()
   where id = p_match_id and status = 'active'
   returning * into strict v_match;

  update public.season_ratings
     set points = (p_next_p1->>'points')::integer,
         peak = (p_next_p1->>'peak')::integer,
         wins = (p_next_p1->>'wins')::integer,
         losses = (p_next_p1->>'losses')::integer,
         draws = (p_next_p1->>'draws')::integer
   where season_id = v_season and player = v_match.p1;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'missing p1 ladder row while settling match %', p_match_id;
  end if;

  update public.season_ratings
     set points = (p_next_p2->>'points')::integer,
         peak = (p_next_p2->>'peak')::integer,
         wins = (p_next_p2->>'wins')::integer,
         losses = (p_next_p2->>'losses')::integer,
         draws = (p_next_p2->>'draws')::integer
   where season_id = v_season and player = v_match.p2;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'missing p2 ladder row while settling match %', p_match_id;
  end if;

  update public.profiles
     set rating = (p_next_p1->>'points')::integer
   where id = v_match.p1;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'missing p1 profile while settling match %', p_match_id;
  end if;

  update public.profiles
     set rating = (p_next_p2->>'points')::integer
   where id = v_match.p2;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'missing p2 profile while settling match %', p_match_id;
  end if;

  return jsonb_build_object('applied', true, 'match', to_jsonb(v_match));
end;
$function$;

revoke execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) to service_role;
