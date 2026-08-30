-- Equipped runes enter ordinary ranked play from SILVER upward.
--
-- This is a capability-gated extension of the existing protocol-v2 action
-- log. Older installed clients already advertise Rune Trial support but route
-- every standard match through pvp-move, so a distinct capability is required
-- before matchmaking may create an action-backed standard match. The match
-- snapshots each seat under the existing profile/queue locks; later profile
-- changes cannot rewrite a game already in progress. Rune Trial keeps its
-- loaned private choices and never reads or overwrites equipped_rune.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

alter table public.matchmaking_queue
  drop constraint matchmaking_queue_capabilities_check;
alter table public.matchmaking_queue
  add constraint matchmaking_queue_capabilities_check
  check (
    capabilities <@ array['rune_trial_v1','equipped_rune_v1']::text[]
    and array_position(capabilities, null) is null
    and cardinality(capabilities) <= 2
    and cardinality(array_positions(capabilities, 'rune_trial_v1')) <= 1
    and cardinality(array_positions(capabilities, 'equipped_rune_v1')) <= 1
  ) not valid;
alter table public.matchmaking_queue
  validate constraint matchmaking_queue_capabilities_check;

-- The original v2 queue RPC remains the compatibility boundary. Widen only
-- its reviewed capability vocabulary; legacy calls and Rune Trial-only calls
-- retain exactly their previous rows.
create or replace function public.enqueue_ranked_player_v2(
  p_player uuid,
  p_protocol_version smallint,
  p_capabilities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_tier text;
begin
  if p_protocol_version not in (1, 2)
     or p_capabilities is null
     or not p_capabilities <@ array['rune_trial_v1','equipped_rune_v1']::text[]
     or array_position(p_capabilities, null) is not null
     or cardinality(p_capabilities) > 2
     or cardinality(array_positions(p_capabilities, 'rune_trial_v1')) > 1
     or cardinality(array_positions(p_capabilities, 'equipped_rune_v1')) > 1 then
    raise exception 'invalid ranked client capabilities' using errcode = '22023';
  end if;
  if ('rune_trial_v1' = any(p_capabilities)
       or 'equipped_rune_v1' = any(p_capabilities))
     and p_protocol_version < 2 then
    raise exception 'ranked rune capabilities require protocol v2' using errcode = '22023';
  end if;
  if 'equipped_rune_v1' = any(p_capabilities)
     and not ('rune_trial_v1' = any(p_capabilities)) then
    raise exception 'equipped rune capability requires Rune Trial action support'
      using errcode = '22023';
  end if;

  v_result := public.enqueue_ranked_player(p_player);
  select ranked_pool_tier into strict v_tier
    from public.profiles
   where id = p_player;
  if v_result->>'status' = 'queued' then
    update public.matchmaking_queue
       set protocol_version = p_protocol_version,
           capabilities = p_capabilities,
           pool_tier = v_tier
     where player_id = p_player;
  end if;
  return v_result || jsonb_build_object(
    'protocol_version', p_protocol_version,
    'capabilities', to_jsonb(p_capabilities),
    'pool_tier', v_tier
  );
end;
$function$;

revoke execute on function public.enqueue_ranked_player_v2(uuid, smallint, text[])
  from public, anon, authenticated;
grant execute on function public.enqueue_ranked_player_v2(uuid, smallint, text[])
  to service_role;

alter table public.matches drop constraint matches_pending_aim_check;
alter table public.matches
  add constraint matches_pending_aim_check
  check (
    pending_aim is null
    or (
      status = 'active'
      and protocol_version = 2
      and rune_rules_version = 1
      and phase = 'playing'
      and pending_aim = 'anvil'
      and pending_aim = case when turn = 1 then p1_rune else p2_rune end
    )
  ) not valid;
alter table public.matches validate constraint matches_pending_aim_check;

alter table public.matches drop constraint matches_format_state_check;
alter table public.matches
  add constraint matches_format_state_check
  check (
    (
      format = 'standard'
      and phase = 'playing'
      and trial_offer is null
      and selection_deadline is null
      and selection_version = 0
      and (
        (
          rune_rules_version is null
          and p1_rune is null
          and p2_rune is null
          and action_version = 0
          and pending_aim is null
        )
        or (
          protocol_version = 2
          and rune_rules_version = 1
        )
      )
    )
    or (
      format = 'rune_trial'
      and modifier = 'classic'
      and pool_tier = 'ivory'
      and protocol_version = 2
      and rune_rules_version = 1
      and trial_offer is not null
      and (
        (
          phase = 'selection'
          and p1_rune is null
          and p2_rune is null
          and selection_deadline is not null
        )
        or (
          phase = 'playing'
          and p1_rune = any(trial_offer)
          and p2_rune = any(trial_offer)
          and selection_deadline is null
        )
      )
    )
  ) not valid;
alter table public.matches validate constraint matches_format_state_check;

-- One stable, uniform-looking choice over the bot's actual inventory. Volatile
-- random() would change on every replay and make a partial rollout impossible
-- to audit. The composite profile/player_runes FK remains the final ownership
-- authority for every returned value.
create or replace function private.bot_owned_rune_choice(p_player uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $function$
  select owned.rune_id
    from public.player_runes owned
   where owned.player_id = p_player
   order by md5(p_player::text || ':bot-equipped-v1:' || owned.rune_id),
            owned.rune_id
   limit 1;
$function$;

comment on function private.bot_owned_rune_choice(uuid) is
  'Stable pseudorandom selection from one player inventory; used only to persist a bot equipped seat.';
revoke all on function private.bot_owned_rune_choice(uuid)
  from public, anon, authenticated, service_role;

with choices as (
  select profile.id, private.bot_owned_rune_choice(profile.id) as rune_id
    from public.profiles profile
   where profile.is_bot
)
update public.profiles profile
   set equipped_rune = choice.rune_id
  from choices choice
 where profile.id = choice.id
   and choice.rune_id is not null
   and profile.equipped_rune is distinct from choice.rune_id;

-- The wrapper first pins whether every CURRENT queue claim advertises the new
-- protocol. That boolean is the Edge Function's decision to omit the legacy
-- bot opener; comparing it under the same locks prevents a re-enqueue race
-- from creating the opposite log shape. v2 still owns the proven atomic match
-- lifecycle and remains callable by the deployed pre-feature function.
create function public.start_ranked_match_v3(
  p_requester uuid,
  p_p1 uuid,
  p_p2 uuid,
  p_seed text,
  p_next_die smallint,
  p_modifier text,
  p_season_id smallint,
  p_queued_opponent uuid,
  p_opening_col smallint,
  p_opening_die smallint,
  p_after_turn smallint,
  p_after_next_die smallint,
  p_protocol_version smallint,
  p_pool_tier text,
  p_format text,
  p_trial_offer text[],
  p_selection_deadline timestamptz,
  p_p1_auto_rune text,
  p_p2_auto_rune text,
  p_equipped_rune_protocol boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_started jsonb;
  v_match public.matches%rowtype;
  v_rows integer;
  v_expected_queue_rows integer;
  v_current_equipped_protocol boolean;
begin
  if p_equipped_rune_protocol is null then
    raise exception 'equipped rune protocol claim is required' using errcode = '22023';
  end if;
  if p_format = 'rune_trial' and p_equipped_rune_protocol then
    raise exception 'Rune Trial does not use equipped rune protocol' using errcode = '22023';
  end if;
  if p_format = 'standard' and p_equipped_rune_protocol
     and (
       p_protocol_version <> 2
       or p_opening_col is not null
       or p_opening_die is not null
       or p_after_turn is not null
       or p_after_next_die is not null
     ) then
    raise exception 'equipped standard start carries legacy opening metadata'
      using errcode = '22023';
  end if;

  -- Match the lifecycle lock order: profiles, then queue claims.
  perform id
    from public.profiles
   where id in (p_p1, p_p2)
   order by id
   for update;
  get diagnostics v_rows = row_count;
  if v_rows <> 2 then
    raise exception 'ranked participant profile is missing' using errcode = 'P0002';
  end if;

  v_expected_queue_rows := case when p_queued_opponent is null then 1 else 2 end;
  select count(*)::integer,
         coalesce(bool_and('equipped_rune_v1' = any(capabilities)), false)
    into v_rows, v_current_equipped_protocol
    from (
      select capabilities
        from public.matchmaking_queue
       where player_id = p_requester
          or player_id = p_queued_opponent
       order by player_id
       for update
    ) claims;
  if v_rows <> v_expected_queue_rows then
    raise exception 'ranked queue claim is no longer available' using errcode = 'P0001';
  end if;
  if p_format = 'standard'
     and p_equipped_rune_protocol is distinct from v_current_equipped_protocol then
    raise exception 'equipped rune capability changed before match start'
      using errcode = 'P0001';
  end if;

  v_started := public.start_ranked_match_v2(
    p_requester, p_p1, p_p2, p_seed, p_next_die, p_modifier,
    p_season_id, p_queued_opponent, p_opening_col, p_opening_die,
    p_after_turn, p_after_next_die, p_protocol_version, p_pool_tier,
    p_format, p_trial_offer, p_selection_deadline,
    p_p1_auto_rune, p_p2_auto_rune
  );

  if coalesce((v_started->>'created')::boolean, false)
     and p_format = 'standard' and p_equipped_rune_protocol then
    update public.matches match
       set rune_rules_version = 1,
           p1_rune = case when p1_profile.rating >= 1260
             then p1_profile.equipped_rune else null end,
           p2_rune = case when p2_profile.rating >= 1260
             then p2_profile.equipped_rune else null end,
           last_move_at = clock_timestamp()
      from public.profiles p1_profile,
           public.profiles p2_profile
     where match.id = (v_started->'match'->>'id')::uuid
       and p1_profile.id = match.p1
       and p2_profile.id = match.p2
     returning match.* into strict v_match;
    v_started := jsonb_set(v_started, '{match}', to_jsonb(v_match), false);
  end if;
  return v_started;
end;
$function$;

revoke execute on function public.start_ranked_match_v3(
  uuid, uuid, uuid, text, smallint, text, smallint,
  uuid, smallint, smallint, smallint, smallint,
  smallint, text, text, text[], timestamptz, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.start_ranked_match_v3(
  uuid, uuid, uuid, text, smallint, text, smallint,
  uuid, smallint, smallint, smallint, smallint,
  smallint, text, text, text[], timestamptz, text, text, boolean
) to service_role;

-- Preserve the settlement transaction and reward contract, then give a bot
-- with no current seat one stable choice from everything it actually owns.
-- Humans remain untouched; an existing bot choice is persistent like theirs.
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
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_result jsonb;
  v_selected_rune text;
  v_inserted_rune text;
  v_bot_equipped_rune text;
  v_p1_tier text;
  v_p2_tier text;
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

  if v_match.status = 'active'
     and v_match.format = 'rune_trial'
     and v_match.phase = 'selection' then
    v_match := private.finalize_rune_trial_locked(p_match_id, true);
  end if;

  if v_match.pending_aim is not null then
    update public.matches
       set pending_aim = null
     where id = p_match_id
     returning * into strict v_match;
  end if;

  v_result := private.apply_settlement_locked(
    p_match_id, p_status, p_winner, p_p1_score, p_p2_score,
    p_p1_delta, p_p2_delta,
    p_expected_p1, p_expected_p2, p_next_p1, p_next_p2
  );
  if not coalesce((v_result->>'applied')::boolean, false) then
    return v_result;
  end if;

  v_p1_tier := private.ranked_pool_tier_for_peak((p_next_p1->>'peak')::integer);
  v_p2_tier := private.ranked_pool_tier_for_peak((p_next_p2->>'peak')::integer);
  update public.profiles
     set ranked_pool_tier = case
       when ranked_pool_tier = 'ivory' or v_p1_tier = 'ivory' then 'ivory'
       when ranked_pool_tier = 'bone' or v_p1_tier = 'bone' then 'bone'
       else 'stone'
     end
   where id = v_match.p1;
  update public.profiles
     set ranked_pool_tier = case
       when ranked_pool_tier = 'ivory' or v_p2_tier = 'ivory' then 'ivory'
       when ranked_pool_tier = 'bone' or v_p2_tier = 'bone' then 'bone'
       else 'stone'
     end
   where id = v_match.p2;

  if v_match.format = 'rune_trial' and p_winner is not null then
    v_selected_rune := case when p_winner = v_match.p1
      then v_match.p1_rune else v_match.p2_rune end;
    if v_selected_rune is null then
      raise exception 'settled Rune Trial has no winner assignment';
    end if;
    insert into public.player_runes (player_id, rune_id, source_match_id)
    values (p_winner, v_selected_rune, p_match_id)
    on conflict (player_id, rune_id) do nothing
    returning rune_id into v_inserted_rune;

    v_result := v_result || jsonb_build_object(
      'reward', jsonb_build_object(
        'rune_id', v_selected_rune,
        'newly_collected', v_inserted_rune is not null
      )
    );

    select private.bot_owned_rune_choice(profile.id)
      into v_bot_equipped_rune
      from public.profiles profile
     where profile.id = p_winner
       and profile.is_bot
       and profile.equipped_rune is null;
    if v_bot_equipped_rune is not null then
      update public.profiles
         set equipped_rune = v_bot_equipped_rune
       where id = p_winner
         and is_bot
         and equipped_rune is null;
    end if;
  end if;
  return v_result;
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

-- The same authoritative action command now serves Rune Trial and a
-- capability-gated standard match. rune_rules_version, rather than the
-- product format label, is the durable log discriminator.
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
  if v_match.status <> 'active' or v_match.rune_rules_version <> 1
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
      if v_rune is null
         or v_rune is distinct from v_expected_rune
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

revoke execute on function public.commit_match_action(
  uuid, uuid, uuid, boolean, integer, smallint, smallint, timestamptz,
  jsonb, jsonb, smallint, smallint, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.commit_match_action(
  uuid, uuid, uuid, boolean, integer, smallint, smallint, timestamptz,
  jsonb, jsonb, smallint, smallint, jsonb, jsonb
) to service_role;

commit;
