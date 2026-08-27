-- Auto-play covers a short absence; it must not cover an indefinite one.
--
-- Before this migration nothing could ever forfeit an away player whose client
-- was still running. Every automatic placement writes last_move_at, and all
-- three STALL_MS gates (pvp-claim, pvp-join, the interval below) measure from
-- it, so the stall clock reset on every auto move and the 30-second threshold
-- was unreachable. A match against a bot could sit active forever, because a
-- bot has no client to call any endpoint at all.
--
-- The rule is therefore a COUNT, not a wall clock: two consecutive automatic
-- placements land as real moves, and the third is refused so the Edge can
-- settle a forfeit instead. A count is also the only stable rule here — the
-- visible turn clock fires 10s after the turn RENDERS (trailing last_move_at
-- by however long the bot-reply animation ran) while the watchdog paths fire
-- on a 13s threshold quantized to a 5s tick, so the same number of seconds
-- buys a different number of moves on each path.
--
-- Both commit functions also gain an own-turn auto branch. AUTO_MS exists to
-- prove an app is gone before one party moves ANOTHER party's die; a client
-- placing on its own turn needs no such proof, so it passes a null stall
-- precondition and is checked for turn ownership instead. The deployed
-- pvp-move and pvp-action both already send the precondition for every
-- recovery, so database-first ordering stays safe: a not-yet-redeployed
-- function keeps taking the gated recovery branch exactly as before.

begin;

alter table public.matches
  add column if not exists p1_auto_streak smallint not null default 0,
  add column if not exists p2_auto_streak smallint not null default 0;

comment on column public.matches.p1_auto_streak is
  'Consecutive automatic placements for p1, reset by any genuine move.';
comment on column public.matches.p2_auto_streak is
  'Consecutive automatic placements for p2, reset by any genuine move.';

-- One streak transition shared by both protocols, so the classic and Rune
-- Trial commit paths cannot drift apart.
create or replace function private.next_auto_streak(
  p_prior smallint,
  p_is_mover boolean,
  p_auto boolean
) returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_is_mover then p_prior
    when p_auto then (p_prior + 1)::smallint
    else 0::smallint
  end;
$$;

revoke all on function private.next_auto_streak(smallint, boolean, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.commit_match_command(
  p_match_id uuid,
  p_command_id uuid,
  p_actor uuid,
  p_requested_col smallint,
  p_auto boolean,
  p_expected_move_count integer,
  p_expected_turn smallint,
  p_expected_next_die smallint,
  p_moves jsonb,
  p_next_turn smallint,
  p_next_die smallint,
  p_settlement jsonb,
  p_response_meta jsonb default '{}'::jsonb,
  p_expected_last_move_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_command private.match_commands%rowtype;
  v_move jsonb;
  v_pos integer := 0;
  v_idx integer;
  v_who smallint;
  v_col smallint;
  v_die smallint;
  v_settled jsonb;
  v_response jsonb;
begin
  if p_requested_col not between -1 and 2
     or p_expected_move_count < 0
     or p_expected_turn not in (0, 1)
     or p_expected_next_die not between 1 and 6
     or jsonb_typeof(p_moves) <> 'array'
     or jsonb_array_length(p_moves) not between 1 and 2
     or jsonb_typeof(coalesce(p_response_meta, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid match command payload' using errcode = '22023';
  end if;

  -- Lock first, then look for the idempotency record. A concurrent copy of the
  -- same command waits here and sees the committed response on its next
  -- READ-COMMITTED statement.
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;

  select * into v_command
    from private.match_commands
   where match_id = p_match_id and command_id = p_command_id;
  if found then
    if v_command.actor <> p_actor
       or v_command.requested_col <> p_requested_col
       or v_command.auto <> p_auto
       or v_command.expected_move_count <> p_expected_move_count then
      raise exception 'command id was reused with different input' using errcode = '22023';
    end if;
    return v_command.response;
  end if;

  if p_actor not in (v_match.p1, v_match.p2) then
    raise exception 'command actor is not a match participant' using errcode = '22023';
  end if;
  if v_match.status <> 'active'
     or v_match.turn <> p_expected_turn
     or v_match.next_die is distinct from p_expected_next_die
     or (select count(*) from public.match_moves where match_id = p_match_id) <> p_expected_move_count then
    raise exception 'match changed before command commit' using errcode = 'P0001';
  end if;
  if p_auto then
    if p_expected_last_move_at is null then
      -- Own-turn self placement: this client's own turn clock ran out. There
      -- is no stall to prove because nobody else's die is being moved, but
      -- the actor must genuinely own the turn it is placing for.
      if (v_match.p1 = p_actor and p_expected_turn <> 1)
         or (v_match.p2 = p_actor and p_expected_turn <> 0) then
        raise exception 'auto command actor does not own the turn' using errcode = '22023';
      end if;
    elsif p_expected_last_move_at is distinct from v_match.last_move_at
       or clock_timestamp() - v_match.last_move_at < interval '12 seconds' then
      -- Recovery: the Edge clock proposed a stall and supplied the projection
      -- it inspected, so the database clock is the authority on the gate.
      raise exception 'command is not stalled yet' using errcode = 'P0001';
    end if;
  elsif p_expected_last_move_at is not null then
    raise exception 'manual command carries a stall precondition' using errcode = '22023';
  elsif (v_match.p1 = p_actor and p_expected_turn <> 1)
     or (v_match.p2 = p_actor and p_expected_turn <> 0) then
    raise exception 'manual command actor does not own the turn' using errcode = '22023';
  end if;

  for v_move in select value from jsonb_array_elements(p_moves)
  loop
    if jsonb_typeof(v_move) <> 'object' then
      raise exception 'match command move is not an object' using errcode = '22023';
    end if;
    v_idx := (v_move->>'idx')::integer;
    v_who := (v_move->>'who')::smallint;
    v_col := (v_move->>'col')::smallint;
    v_die := (v_move->>'die')::smallint;
    if v_idx <> p_expected_move_count + v_pos
       or v_who <> ((p_expected_turn + v_pos) % 2)::smallint
       or v_col not between 0 and 2
       or v_die not between 1 and 6
       or (v_pos = 0 and v_die <> p_expected_next_die) then
      raise exception 'invalid move sequence in match command' using errcode = '22023';
    end if;
    insert into public.match_moves (match_id, idx, who, col, die)
    values (p_match_id, v_idx, v_who, v_col, v_die);
    v_pos := v_pos + 1;
  end loop;

  if p_settlement is null then
    if p_next_turn not in (0, 1) or p_next_die not between 1 and 6 then
      raise exception 'nonterminal command has no next projection' using errcode = '22023';
    end if;
    -- Only the mover's streak moves. A bot reply committed in this same
    -- command is the other seat and must never disturb the human's count.
    update public.matches
       set turn = p_next_turn,
           next_die = p_next_die,
           last_move_at = clock_timestamp(),
           p1_auto_streak =
             private.next_auto_streak(p1_auto_streak, p_expected_turn = 1, p_auto),
           p2_auto_streak =
             private.next_auto_streak(p2_auto_streak, p_expected_turn = 0, p_auto)
     where id = p_match_id and status = 'active'
     returning * into strict v_match;
    v_response := jsonb_build_object('match', to_jsonb(v_match))
      || coalesce(p_response_meta, '{}'::jsonb);
  else
    if jsonb_typeof(p_settlement) <> 'object' then
      raise exception 'terminal settlement is not an object' using errcode = '22023';
    end if;
    select public.settle_match(
      p_match_id,
      p_settlement->>'status',
      (p_settlement->>'winner')::uuid,
      (p_settlement->>'p1_score')::integer,
      (p_settlement->>'p2_score')::integer,
      (p_settlement->>'p1_delta')::integer,
      (p_settlement->>'p2_delta')::integer,
      p_settlement->'expected_p1',
      p_settlement->'expected_p2',
      p_settlement->'next_p1',
      p_settlement->'next_p2'
    ) into v_settled;
    if not coalesce((v_settled->>'applied')::boolean, false) then
      raise exception 'active command did not claim its settlement' using errcode = 'P0001';
    end if;
    v_response := jsonb_build_object('match', v_settled->'match')
      || coalesce(p_response_meta, '{}'::jsonb);
  end if;

  insert into private.match_commands (
    match_id, command_id, actor, requested_col, auto, expected_move_count, response
  ) values (
    p_match_id, p_command_id, p_actor, p_requested_col, p_auto, p_expected_move_count, v_response
  );
  return v_response;
end;
$function$;

create or replace function public.commit_match_action(
  p_match_id uuid,
  p_command_id uuid,
  p_actor uuid,
  p_auto boolean,
  p_expected_action_version integer,
  p_expected_turn smallint,
  p_expected_next_die smallint,
  p_expected_last_move_at timestamptz,
  p_requested_action jsonb,
  p_actions jsonb,
  p_next_turn smallint,
  p_next_die smallint,
  p_settlement jsonb,
  p_response_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_command private.match_action_commands%rowtype;
  v_action jsonb;
  v_first jsonb;
  v_pos integer := 0;
  v_action_count integer;
  v_move_count integer;
  v_idx integer;
  v_move_idx integer;
  v_who smallint;
  v_turn smallint;
  v_kind text;
  v_rune text;
  v_expected_rune text;
  v_target smallint;
  v_col smallint;
  v_die_before smallint;
  v_die_after smallint;
  v_current_die smallint;
  v_cast_this_turn boolean;
  v_pending_aim text;
  v_settled jsonb;
  v_response jsonb;
  v_committed_actions jsonb;
begin
  if p_expected_action_version is null or p_expected_action_version < 0
     or p_expected_turn is null or p_expected_turn not in (0, 1)
     or p_expected_next_die is null or p_expected_next_die not between 1 and 6
     or p_auto is null or p_actions is null or jsonb_typeof(p_actions) <> 'array'
     or jsonb_array_length(p_actions) not between 1 and 5
     or jsonb_typeof(coalesce(p_response_meta, '{}'::jsonb)) <> 'object'
     or (p_auto and p_requested_action is not null)
     or (not p_auto and jsonb_typeof(p_requested_action) <> 'object') then
    raise exception 'invalid match action payload' using errcode = '22023';
  end if;

  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;

  select * into v_command
    from private.match_action_commands
   where match_id = p_match_id and command_id = p_command_id;
  if found then
    if v_command.actor <> p_actor
       or v_command.auto <> p_auto
       or v_command.expected_action_version <> p_expected_action_version
       or v_command.requested_action is distinct from p_requested_action then
      raise exception 'action command id was reused with different input'
        using errcode = '22023';
    end if;
    return v_command.response;
  end if;

  if p_actor not in (v_match.p1, v_match.p2) then
    raise exception 'action actor is not a match participant' using errcode = '42501';
  end if;
  if v_match.status <> 'active' or v_match.format <> 'rune_trial'
     or v_match.phase <> 'playing' or v_match.protocol_version <> 2
     or v_match.turn <> p_expected_turn
     or v_match.next_die is distinct from p_expected_next_die
     or v_match.action_version <> p_expected_action_version
     or (select count(*) from public.match_actions where match_id = p_match_id)
        <> p_expected_action_version then
    raise exception 'match changed before action commit' using errcode = 'P0001';
  end if;
  if p_auto then
    if p_expected_last_move_at is null then
      -- Own-turn self placement: no other party's die is being moved, so
      -- there is no stall to prove — only turn ownership to verify.
      if (v_match.p1 = p_actor and p_expected_turn <> 1)
         or (v_match.p2 = p_actor and p_expected_turn <> 0) then
        raise exception 'auto action actor does not own the turn' using errcode = '22023';
      end if;
    elsif p_expected_last_move_at is distinct from v_match.last_move_at
       or clock_timestamp() - v_match.last_move_at < interval '12 seconds' then
      raise exception 'action is not stalled yet' using errcode = 'P0001';
    end if;
  elsif p_expected_last_move_at is not null then
    raise exception 'manual action carries a stall precondition' using errcode = '22023';
  elsif (v_match.p1 = p_actor and p_expected_turn <> 1)
     or (v_match.p2 = p_actor and p_expected_turn <> 0) then
    raise exception 'manual action actor does not own the turn' using errcode = '22023';
  end if;

  v_first := p_actions->0;
  if not p_auto then
    if p_requested_action->>'kind' is distinct from v_first->>'kind'
       or (
         p_requested_action->>'kind' in ('aim', 'cast')
         and (
           p_requested_action->>'rune_id' is distinct from v_first->>'rune_id'
           or (
             p_requested_action->>'kind' = 'cast'
             and (p_requested_action->>'target_col')::smallint
                 is distinct from (v_first->>'target_col')::smallint
           )
         )
       )
       or (
         p_requested_action->>'kind' = 'place'
         and (p_requested_action->>'placed_col')::smallint
             is distinct from (v_first->>'placed_col')::smallint
       ) then
      raise exception 'authoritative actions do not match requested action'
        using errcode = '22023';
    end if;
  end if;

  select count(*)::integer into v_move_count
    from public.match_moves
   where match_id = p_match_id;
  v_pending_aim := v_match.pending_aim;
  select coalesce((
    select action.kind in ('aim', 'cast') and action.who = p_expected_turn
      from public.match_actions action
     where action.match_id = p_match_id
     order by action.idx desc
     limit 1
  ), false) or v_pending_aim is not null into v_cast_this_turn;

  v_turn := p_expected_turn;
  v_current_die := p_expected_next_die;
  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    if jsonb_typeof(v_action) <> 'object' then
      raise exception 'match action is not an object' using errcode = '22023';
    end if;
    v_idx := (v_action->>'idx')::integer;
    v_who := (v_action->>'who')::smallint;
    v_kind := v_action->>'kind';
    v_die_before := (v_action->>'die_before')::smallint;
    v_die_after := (v_action->>'die_after')::smallint;
    if v_idx is distinct from p_expected_action_version + v_pos
       or v_who is distinct from v_turn
       or v_die_before is distinct from v_current_die
       or v_kind is null or v_kind not in ('aim', 'cast', 'place') then
      raise exception 'invalid action sequence' using errcode = '22023';
    end if;

    if v_kind = 'aim' then
      v_rune := v_action->>'rune_id';
      v_expected_rune := case when v_who = 1 then v_match.p1_rune else v_match.p2_rune end;
      if v_cast_this_turn or v_pending_aim is not null
         or v_rune is distinct from 'anvil'
         or v_rune is distinct from v_expected_rune
         or v_die_after is distinct from v_die_before
         or (v_action->>'move_idx') is not null
         or (v_action->>'target_col') is not null
         or (v_action->>'placed_col') is not null then
        raise exception 'invalid aim action' using errcode = '22023';
      end if;
      v_pending_aim := v_rune;
      v_cast_this_turn := true;
      insert into public.match_actions (
        match_id, idx, move_idx, who, kind, rune_id, target_col,
        placed_col, die_before, die_after
      ) values (
        p_match_id, v_idx, null, v_who, 'aim', v_rune, null,
        null, v_die_before, v_die_after
      );
    elsif v_kind = 'cast' then
      v_rune := v_action->>'rune_id';
      v_target := (v_action->>'target_col')::smallint;
      v_expected_rune := case when v_who = 1 then v_match.p1_rune else v_match.p2_rune end;
      if v_rune is distinct from v_expected_rune
         or v_target is null or v_target not between -1 and 2
         or (v_action->>'move_idx') is not null
         or (v_action->>'placed_col') is not null
         or (
           v_pending_aim is null
           and (v_cast_this_turn or v_rune = 'anvil')
         )
         or (
           v_pending_aim is not null
           and (not v_cast_this_turn or v_rune is distinct from v_pending_aim)
         ) then
        raise exception 'invalid cast action' using errcode = '22023';
      end if;
      v_pending_aim := null;
      v_cast_this_turn := true;
      v_current_die := v_die_after;
      insert into public.match_actions (
        match_id, idx, move_idx, who, kind, rune_id, target_col,
        placed_col, die_before, die_after
      ) values (
        p_match_id, v_idx, null, v_who, 'cast', v_rune, v_target,
        null, v_die_before, v_die_after
      );
    else
      v_move_idx := (v_action->>'move_idx')::integer;
      v_col := (v_action->>'placed_col')::smallint;
      if v_pending_aim is not null
         or v_move_idx is distinct from v_move_count
         or v_col is null or v_col not between 0 and 2
         or (v_action->>'rune_id') is not null
         or (v_action->>'target_col') is not null then
        raise exception 'invalid placement action' using errcode = '22023';
      end if;
      insert into public.match_actions (
        match_id, idx, move_idx, who, kind, rune_id, target_col,
        placed_col, die_before, die_after
      ) values (
        p_match_id, v_idx, v_move_idx, v_who, 'place', null, null,
        v_col, v_die_before, v_die_after
      );
      insert into public.match_moves (match_id, idx, who, col, die)
      values (p_match_id, v_move_idx, v_who, v_col, v_die_before);
      v_move_count := v_move_count + 1;
      v_turn := (1 - v_turn)::smallint;
      v_cast_this_turn := false;
      v_current_die := v_die_after;
    end if;
    v_pos := v_pos + 1;
  end loop;

  v_action_count := p_expected_action_version + v_pos;
  if p_settlement is null then
    if p_next_turn is distinct from v_turn
       or p_next_die is null
       or p_next_die is distinct from v_current_die then
      raise exception 'nonterminal action has no matching next projection'
        using errcode = '22023';
    end if;
    -- Only the acting seat's streak moves; see commit_match_command.
    update public.matches
       set action_version = v_action_count,
           pending_aim = v_pending_aim,
           last_move_at = clock_timestamp(),
           turn = p_next_turn,
           next_die = p_next_die,
           p1_auto_streak =
             private.next_auto_streak(p1_auto_streak, p_expected_turn = 1, p_auto),
           p2_auto_streak =
             private.next_auto_streak(p2_auto_streak, p_expected_turn = 0, p_auto)
     where id = p_match_id and status = 'active'
     returning * into strict v_match;
  else
    if jsonb_typeof(p_settlement) <> 'object'
       or p_next_turn is not null or p_next_die is not null
       or v_pending_aim is not null or v_current_die is not null then
      raise exception 'invalid terminal action settlement' using errcode = '22023';
    end if;
    update public.matches
       set action_version = v_action_count,
           pending_aim = null,
           last_move_at = clock_timestamp()
     where id = p_match_id and status = 'active';
    select public.settle_match(
      p_match_id,
      p_settlement->>'status',
      (p_settlement->>'winner')::uuid,
      (p_settlement->>'p1_score')::integer,
      (p_settlement->>'p2_score')::integer,
      (p_settlement->>'p1_delta')::integer,
      (p_settlement->>'p2_delta')::integer,
      p_settlement->'expected_p1',
      p_settlement->'expected_p2',
      p_settlement->'next_p1',
      p_settlement->'next_p2'
    ) into v_settled;
    if not coalesce((v_settled->>'applied')::boolean, false) then
      raise exception 'active action did not claim its settlement' using errcode = 'P0001';
    end if;
    v_match := jsonb_populate_record(null::public.matches, v_settled->'match');
  end if;

  select jsonb_agg(to_jsonb(action) - 'match_id' order by action.idx)
    into v_committed_actions
    from public.match_actions action
   where action.match_id = p_match_id
     and action.idx >= p_expected_action_version
     and action.idx < v_action_count;

  v_response := jsonb_build_object(
    'match', to_jsonb(v_match),
    'actions', coalesce(v_committed_actions, '[]'::jsonb),
    'action_version', v_action_count
  ) || coalesce(p_response_meta, '{}'::jsonb);
  if v_settled ? 'reward' then
    v_response := v_response || jsonb_build_object('reward', v_settled->'reward');
  end if;

  insert into private.match_action_commands (
    match_id, command_id, actor, auto, expected_action_version,
    requested_action, response
  ) values (
    p_match_id, p_command_id, p_actor, p_auto, p_expected_action_version,
    p_requested_action, v_response
  );
  return v_response;
end;
$function$;

commit;
