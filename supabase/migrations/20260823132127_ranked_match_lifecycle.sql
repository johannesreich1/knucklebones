-- Serialize every ranked-match lifecycle transition around the players it
-- affects. The old Edge flow checked for an active match, inserted a match,
-- inserted its private seed, and removed queue rows in separate HTTP requests.
-- Two joiners could therefore seat the same player twice, and account deletion
-- could miss a match created after its active-match snapshot.

begin;

create table private.active_match_players (
  player uuid primary key references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index active_match_players_match_idx
  on private.active_match_players (match_id);

create table private.deleting_accounts (
  player uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

revoke all on table private.active_match_players from public, anon, authenticated, service_role;
revoke all on table private.deleting_accounts from public, anon, authenticated, service_role;

-- Hold legacy match/queue writers out from the validation snapshot through
-- trigger installation. The explicit transaction is required because the CLI
-- otherwise applies migration statements individually.
lock table public.matches, public.matchmaking_queue in share row exclusive mode;

-- Fail the migration rather than silently choosing one of two already-active
-- matches. A production ledger with this condition needs an owner decision
-- before an invariant can be installed honestly.
do $block$
begin
  if exists (
    select participant
      from (
        select p1 as participant from public.matches where status = 'active'
        union all
        select p2 as participant from public.matches where status = 'active'
      ) active
     group by participant
    having count(*) > 1
  ) then
    raise exception 'cannot install active-player invariant: a player has multiple active matches';
  end if;
end;
$block$;

insert into private.active_match_players (player, match_id)
select participant, match_id
  from (
    select p1 as participant, id as match_id
      from public.matches where status = 'active'
    union all
    select p2 as participant, id as match_id
      from public.matches where status = 'active'
  ) active
 order by participant;

delete from public.matchmaking_queue queued
 using private.active_match_players active
 where queued.player_id = active.player;

-- Take lifecycle locks before an active row becomes visible. This guard makes
-- the deletion barrier apply to legacy service writers as well as the new RPC.
create function private.guard_active_match_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'active' then
    perform id
      from public.profiles
     where id in (new.p1, new.p2)
     order by id
     for update;
    if exists (
      select 1 from private.deleting_accounts
       where player in (new.p1, new.p2)
    ) then
      raise exception 'ranked participant is deleting their account' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_active_match_lifecycle()
  from public, anon, authenticated, service_role;

create trigger matches_guard_active_lifecycle
before insert or update of status, p1, p2 on public.matches
for each row execute function private.guard_active_match_lifecycle();

-- The active-seat trigger is the database invariant. RPCs below provide the
-- useful atomic workflows, but even an older service-role writer cannot seat
-- a player twice or leave an active participant available in matchmaking.
create function private.sync_active_match_players()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'active' then
      delete from private.active_match_players where match_id = old.id;
    end if;
  end if;

  if new.status = 'active' then
    insert into private.active_match_players (player, match_id)
    select player, new.id
      from (values (new.p1), (new.p2)) participants(player)
     order by player;
    delete from public.matchmaking_queue
     where player_id in (new.p1, new.p2);
  end if;
  return new;
end;
$function$;

revoke all on function private.sync_active_match_players() from public, anon, authenticated, service_role;

create trigger matches_sync_active_players
after insert or update of status, p1, p2 on public.matches
for each row execute function private.sync_active_match_players();

-- Queueing takes the same profile-row lock as match creation and deletion.
-- Whichever operation wins is therefore visible to the one that follows: a
-- deletion removes an earlier queue row, and a later enqueue sees the durable
-- deletion marker instead of recreating it.
create function public.enqueue_ranked_player(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match_id uuid;
begin
  perform id from public.profiles where id = p_player for update;
  if not found then
    raise exception 'ranked player does not exist' using errcode = 'P0002';
  end if;

  if exists (select 1 from private.deleting_accounts where player = p_player) then
    return jsonb_build_object('status', 'deleting');
  end if;

  select match_id into v_match_id
    from private.active_match_players
   where player = p_player;
  if found then
    delete from public.matchmaking_queue where player_id = p_player;
    return jsonb_build_object('status', 'active', 'match_id', v_match_id);
  end if;

  insert into public.matchmaking_queue (player_id)
  values (p_player)
  on conflict (player_id) do nothing;
  return jsonb_build_object('status', 'queued');
end;
$function$;

revoke execute on function public.enqueue_ranked_player(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_ranked_player(uuid) to service_role;

-- Queue cancellation shares the participant profile lock with match start.
-- Its result is linearizable: `left` means no later start can consume the
-- deleted claim, while `matched` identifies the match that committed first.
create function public.leave_ranked_queue()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player uuid := auth.uid();
  v_match_id uuid;
begin
  if v_player is null then
    raise exception 'ranked queue leave requires authentication' using errcode = '42501';
  end if;

  perform id from public.profiles where id = v_player for update;
  if not found then
    raise exception 'ranked player does not exist' using errcode = 'P0002';
  end if;

  select match_id into v_match_id
    from private.active_match_players
   where player = v_player;
  if found then
    delete from public.matchmaking_queue where player_id = v_player;
    return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
  end if;

  delete from public.matchmaking_queue where player_id = v_player;
  return jsonb_build_object('status', 'left');
end;
$function$;

revoke execute on function public.leave_ranked_queue()
  from public, anon, service_role;
grant execute on function public.leave_ranked_queue() to authenticated;

-- Keep the already-reviewed settlement implementation intact behind a new
-- lifecycle lock-order wrapper. Moving it private avoids a second public path
-- that could skip the profile locks. The wrapper locks match -> both profiles;
-- only then may the inner status update release active seats and update the
-- same profile rows, so a legacy active insert cannot form a lock cycle.
alter function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) set schema private;
alter function private.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) rename to apply_settlement_locked;
revoke all on function private.apply_settlement_locked(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

create function public.settle_match(
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
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
begin
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match % does not exist', p_match_id using errcode = 'P0002';
  end if;

  perform id
    from public.profiles
   where id in (v_match.p1, v_match.p2)
   order by id
   for update;

  return private.apply_settlement_locked(
    p_match_id, p_status, p_winner, p_p1_score, p_p2_score,
    p_p1_delta, p_p2_delta,
    p_expected_p1, p_expected_p2, p_next_p1, p_next_p2
  );
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

-- Create the public match, private seed, active-player seats, queue claims, and
-- optional bot opening move as one short database transaction. Game rules and
-- bot choice remain in shared TypeScript; this function only compare/checks the
-- trusted result and persists it atomically.
create function public.start_ranked_match(
  p_requester uuid,
  p_p1 uuid,
  p_p2 uuid,
  p_seed text,
  p_next_die smallint,
  p_modifier text,
  p_season_id smallint,
  p_queued_opponent uuid default null,
  p_opening_col smallint default null,
  p_opening_die smallint default null,
  p_after_turn smallint default null,
  p_after_next_die smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_existing public.matches%rowtype;
  v_rows integer;
  v_expected_queue_rows integer;
  v_other uuid;
begin
  if p_p1 = p_p2 or p_requester not in (p_p1, p_p2) then
    raise exception 'invalid ranked participants' using errcode = '22023';
  end if;
  if p_seed is null or p_seed = '' or p_next_die not between 1 and 6 then
    raise exception 'invalid ranked seed or opening die' using errcode = '22023';
  end if;

  -- One global UUID order prevents lifecycle operations sharing a player from
  -- deadlocking each other.
  perform id
    from public.profiles
   where id in (p_p1, p_p2)
   order by id
   for update;
  get diagnostics v_rows = row_count;
  if v_rows <> 2 then
    raise exception 'ranked participant profile is missing' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from private.deleting_accounts
     where player in (p_p1, p_p2)
  ) then
    raise exception 'ranked participant is deleting their account' using errcode = 'P0001';
  end if;

  select m.* into v_existing
    from private.active_match_players active
    join public.matches m on m.id = active.match_id
   where active.player = p_requester;
  if found then
    return jsonb_build_object('created', false, 'match', to_jsonb(v_existing));
  end if;

  if exists (
    select 1 from private.active_match_players
     where player in (p_p1, p_p2)
  ) then
    raise exception 'ranked participant is already active' using errcode = 'P0001';
  end if;

  v_other := case when p_requester = p_p1 then p_p2 else p_p1 end;
  if p_queued_opponent is not null then
    if p_queued_opponent <> v_other then
      raise exception 'queued opponent is not the other participant' using errcode = '22023';
    end if;
  end if;

  -- A direct authenticated leave and the service's stale-row cleanup both
  -- delete queue rows without taking profile locks. Lock every queue claim in
  -- UUID order so either the leave wins (and this command aborts) or match
  -- creation wins (and consumes the row before the leave can resume).
  v_expected_queue_rows := case when p_queued_opponent is null then 1 else 2 end;
  select count(*) into v_rows
    from (
      select player_id
        from public.matchmaking_queue
       where player_id = p_requester
          or player_id = p_queued_opponent
       order by player_id
       for update
    ) claims;
  if v_rows <> v_expected_queue_rows then
    raise exception 'ranked queue claim is no longer available' using errcode = 'P0001';
  end if;

  if p_opening_col is null then
    if p_opening_die is not null or p_after_turn is not null or p_after_next_die is not null then
      raise exception 'incomplete bot opening projection' using errcode = '22023';
    end if;
  elsif p_opening_col not between 0 and 2
     or p_opening_die is distinct from p_next_die
     or p_after_turn not in (0, 1)
     or p_after_next_die not between 1 and 6 then
    raise exception 'invalid bot opening projection' using errcode = '22023';
  end if;

  begin
    insert into public.matches (p1, p2, next_die, modifier, season_id)
    values (p_p1, p_p2, p_next_die, p_modifier, p_season_id)
    returning * into strict v_match;
  exception when unique_violation then
    -- A legacy writer that did not take the profile locks may still race the
    -- active-seat trigger. Return the requester's winning match if there is one.
    select m.* into v_existing
      from private.active_match_players active
      join public.matches m on m.id = active.match_id
     where active.player = p_requester;
    if found then
      return jsonb_build_object('created', false, 'match', to_jsonb(v_existing));
    end if;
    raise;
  end;

  insert into public.match_seeds (match_id, seed)
  values (v_match.id, p_seed);

  if p_opening_col is not null then
    insert into public.match_moves (match_id, idx, who, col, die)
    values (v_match.id, 0, 1, p_opening_col, p_opening_die);
    update public.matches
       set turn = p_after_turn,
           next_die = p_after_next_die,
           last_move_at = clock_timestamp()
     where id = v_match.id
     returning * into strict v_match;
  end if;

  delete from public.matchmaking_queue where player_id in (p_p1, p_p2);
  return jsonb_build_object('created', true, 'match', to_jsonb(v_match));
end;
$function$;

revoke execute on function public.start_ranked_match(
  uuid, uuid, uuid, text, smallint, text, smallint,
  uuid, smallint, smallint, smallint, smallint
) from public, anon, authenticated;
grant execute on function public.start_ranked_match(
  uuid, uuid, uuid, text, smallint, text, smallint,
  uuid, smallint, smallint, smallint, smallint
) to service_role;

-- Establish a durable barrier before the Edge Function snapshots active
-- matches. Match creation takes the same profile lock and checks this marker,
-- so no match can appear after the returned list.
create function public.prepare_account_deletion(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_matches jsonb;
begin
  perform id from public.profiles where id = p_player for update;
  if not found then
    raise exception 'account profile does not exist' using errcode = 'P0002';
  end if;

  insert into private.deleting_accounts (player)
  values (p_player)
  on conflict (player) do nothing;
  delete from public.matchmaking_queue where player_id = p_player;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
    into v_matches
    from public.matches m
   where m.status = 'active'
     and (m.p1 = p_player or m.p2 = p_player);
  return v_matches;
end;
$function$;

revoke execute on function public.prepare_account_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

commit;
