-- Ranked pool progression, Rune Trial selection, permanent rune ownership,
-- and the participant-readable protocol-v2 aim/cast/place action log.
--
-- The rollout is additive. Existing Edge Functions keep using the original
-- enqueue/start/move RPC signatures and therefore create protocol-v1 standard
-- matches. Compatible clients use the suffixed v2 lifecycle RPCs; Rune Trial
-- is impossible unless both participants advertise its capability.

begin;

-- LIMITED already exists in the shared mode registry and ranked draw. Keep the
-- database allow-list complete before the progressive outcome picker ships.
alter table public.matches drop constraint matches_modifier_check;
alter table public.matches add constraint matches_modifier_check
  check (modifier in (
    'classic', 'rowswitch', 'rowmult', 'colshield',
    'singlestrike', 'bounty', 'limited'
  ));

create function private.ranked_pool_tier_for_peak(p_peak integer)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when coalesce(p_peak, 0) >= 720 then 'ivory'
    when coalesce(p_peak, 0) >= 300 then 'bone'
    else 'stone'
  end;
$function$;

revoke all on function private.ranked_pool_tier_for_peak(integer)
  from public, anon, authenticated, service_role;

alter table public.profiles
  add column ranked_pool_tier text not null default 'stone'
  constraint profiles_ranked_pool_tier_check
  check (ranked_pool_tier in ('stone', 'bone', 'ivory'));

-- Historical peak, not current points, grants permanent access. Max across all
-- seasons also makes this backfill survive a prior soft reset or demotion.
with historical as (
  select player, max(peak)::integer as peak
    from public.season_ratings
   group by player
)
update public.profiles profile
   set ranked_pool_tier = private.ranked_pool_tier_for_peak(historical.peak)
  from historical
 where historical.player = profile.id;

alter table public.matches
  add column format text not null default 'standard',
  add column protocol_version smallint not null default 1,
  add column rune_rules_version smallint,
  add column pool_tier text not null default 'stone',
  add column phase text not null default 'playing',
  add column trial_offer text[],
  add column p1_rune text,
  add column p2_rune text,
  add column selection_deadline timestamptz,
  add column selection_version integer not null default 0,
  add column action_version integer not null default 0,
  add column pending_aim text;

alter table public.matches
  add constraint matches_format_check
    check (format in ('standard', 'rune_trial')),
  add constraint matches_protocol_version_check
    check (protocol_version in (1, 2)),
  add constraint matches_rune_rules_version_check
    check (rune_rules_version is null or rune_rules_version = 1),
  add constraint matches_pool_tier_check
    check (pool_tier in ('stone', 'bone', 'ivory')),
  add constraint matches_phase_check
    check (phase in ('selection', 'playing')),
  add constraint matches_selection_version_check
    check (selection_version >= 0),
  add constraint matches_action_version_check
    check (action_version >= 0),
  add constraint matches_trial_offer_check
    check (
      trial_offer is null
      or (
        cardinality(trial_offer) = 3
        and trial_offer <@ array['fate','nudge','ward','sunder','pilfer','anvil']::text[]
        and array_position(trial_offer, null) is null
        and cardinality(array_positions(trial_offer, 'fate')) <= 1
        and cardinality(array_positions(trial_offer, 'nudge')) <= 1
        and cardinality(array_positions(trial_offer, 'ward')) <= 1
        and cardinality(array_positions(trial_offer, 'sunder')) <= 1
        and cardinality(array_positions(trial_offer, 'pilfer')) <= 1
        and cardinality(array_positions(trial_offer, 'anvil')) <= 1
      )
    ),
  add constraint matches_trial_runes_check
    check (
      (p1_rune is null or p1_rune in ('fate','nudge','ward','sunder','pilfer','anvil'))
      and (p2_rune is null or p2_rune in ('fate','nudge','ward','sunder','pilfer','anvil'))
    ),
  add constraint matches_pending_aim_check
    check (
      pending_aim is null
      or (
        status = 'active'
        and format = 'rune_trial'
        and phase = 'playing'
        and pending_aim = 'anvil'
        and pending_aim = case when turn = 1 then p1_rune else p2_rune end
      )
    ),
  add constraint matches_format_state_check
    check (
      (
        format = 'standard'
        and phase = 'playing'
        and rune_rules_version is null
        and trial_offer is null
        and p1_rune is null
        and p2_rune is null
        and selection_deadline is null
      )
      or (
        format = 'rune_trial'
        and modifier = 'classic'
        and pool_tier = 'ivory'
        and protocol_version = 2
        and rune_rules_version = 1
        and trial_offer is not null
        and (
          (phase = 'selection' and p1_rune is null and p2_rune is null
            and selection_deadline is not null)
          or
          (phase = 'playing' and p1_rune = any(trial_offer)
            and p2_rune = any(trial_offer) and selection_deadline is null)
        )
      )
    );

alter table public.matchmaking_queue
  add column protocol_version smallint not null default 1,
  add column capabilities text[] not null default '{}'::text[],
  add column pool_tier text not null default 'stone';

alter table public.matchmaking_queue
  add constraint matchmaking_queue_protocol_version_check
    check (protocol_version in (1, 2)),
  add constraint matchmaking_queue_capabilities_check
    check (
      capabilities <@ array['rune_trial_v1']::text[]
      and array_position(capabilities, null) is null
      and cardinality(capabilities) <= 1
    ),
  add constraint matchmaking_queue_pool_tier_check
    check (pool_tier in ('stone', 'bone', 'ivory'));

create table public.player_runes (
  player_id uuid not null references public.profiles(id) on delete cascade,
  rune_id text not null
    check (rune_id in ('fate','nudge','ward','sunder','pilfer','anvil')),
  source_match_id uuid references public.matches(id) on delete set null,
  collected_at timestamptz not null default now(),
  seen_at timestamptz,
  primary key (player_id, rune_id),
  check (seen_at is null or seen_at >= collected_at)
);

create index player_runes_source_match_idx
  on public.player_runes (source_match_id)
  where source_match_id is not null;

alter table public.player_runes enable row level security;
create policy player_runes_select_own on public.player_runes
  for select to authenticated
  using (player_id = (select auth.uid()));

revoke all on table public.player_runes from public, anon, authenticated;
grant select on table public.player_runes to authenticated;
grant select, insert, update, delete on table public.player_runes to service_role;

create table public.match_actions (
  match_id uuid not null references public.matches(id) on delete cascade,
  idx integer not null check (idx >= 0),
  move_idx integer check (move_idx >= 0),
  who smallint not null check (who in (0, 1)),
  kind text not null check (kind in ('aim', 'cast', 'place')),
  rune_id text,
  target_col smallint,
  placed_col smallint,
  die_before smallint not null check (die_before between 1 and 6),
  die_after smallint check (die_after between 1 and 6),
  created_at timestamptz not null default now(),
  primary key (match_id, idx),
  unique (match_id, move_idx),
  check (
    (
      kind = 'aim'
      and move_idx is null
      and rune_id = 'anvil'
      and target_col is null
      and placed_col is null
      and die_after is not null
      and die_after = die_before
    )
    or (
      kind = 'cast'
      and move_idx is null
      and rune_id in ('fate','nudge','ward','sunder','pilfer','anvil')
      and target_col is not null
      and target_col between -1 and 2
      and placed_col is null
    )
    or (
      kind = 'place'
      and move_idx is not null
      and rune_id is null
      and target_col is null
      and placed_col between 0 and 2
    )
  )
);

alter table public.match_actions enable row level security;
create policy match_actions_select_participant on public.match_actions
  for select to authenticated
  using (
    exists (
      select 1
        from public.matches match
       where match.id = match_id
         and (match.p1 = (select auth.uid()) or match.p2 = (select auth.uid()))
    )
  );

revoke all on table public.match_actions from public, anon, authenticated;
grant select on table public.match_actions to authenticated;
grant select, insert, update, delete on table public.match_actions to service_role;

alter publication supabase_realtime add table public.match_actions;

create table private.rune_trial_choices (
  match_id uuid primary key references public.matches(id) on delete cascade,
  p1_choice text check (p1_choice in ('fate','nudge','ward','sunder','pilfer','anvil')),
  p2_choice text check (p2_choice in ('fate','nudge','ward','sunder','pilfer','anvil')),
  p1_auto_rune text not null
    check (p1_auto_rune in ('fate','nudge','ward','sunder','pilfer','anvil')),
  p2_auto_rune text not null
    check (p2_auto_rune in ('fate','nudge','ward','sunder','pilfer','anvil')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.rune_trial_selection_commands (
  match_id uuid not null references public.matches(id) on delete cascade,
  command_id uuid not null,
  actor uuid not null references public.profiles(id) on delete cascade,
  rune_id text,
  auto boolean not null,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (match_id, command_id)
);

create index rune_trial_selection_commands_retention_idx
  on private.rune_trial_selection_commands (created_at, match_id, command_id);
create index rune_trial_selection_commands_actor_idx
  on private.rune_trial_selection_commands (actor);

create table private.match_action_commands (
  match_id uuid not null references public.matches(id) on delete cascade,
  command_id uuid not null,
  actor uuid not null references public.profiles(id) on delete cascade,
  auto boolean not null,
  expected_action_version integer not null check (expected_action_version >= 0),
  requested_action jsonb,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (match_id, command_id),
  check (requested_action is null or jsonb_typeof(requested_action) = 'object')
);

create index match_action_commands_retention_idx
  on private.match_action_commands (created_at, match_id, command_id);
create index match_action_commands_actor_idx
  on private.match_action_commands (actor);

revoke all on table private.rune_trial_choices,
  private.rune_trial_selection_commands,
  private.match_action_commands
  from public, anon, authenticated, service_role;

create function public.acknowledge_rune_reward(reward_rune_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player uuid := auth.uid();
begin
  if v_player is null then
    raise exception 'rune reward acknowledgement requires authentication'
      using errcode = '42501';
  end if;
  if reward_rune_id is null
     or reward_rune_id not in ('fate','nudge','ward','sunder','pilfer','anvil') then
    raise exception 'unknown rune reward' using errcode = '22023';
  end if;

  update public.player_runes
     set seen_at = coalesce(seen_at, clock_timestamp())
   where player_id = v_player
     and rune_id = reward_rune_id;
  return found;
end;
$function$;

revoke execute on function public.acknowledge_rune_reward(text)
  from public, anon, service_role;
grant execute on function public.acknowledge_rune_reward(text)
  to authenticated;

-- The v2 queue wrapper preserves the established profile/queue lock order by
-- invoking the legacy atomic RPC inside the same transaction, then stamps the
-- durable capability snapshot before the row can become visible.
create function public.enqueue_ranked_player_v2(
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
     or not p_capabilities <@ array['rune_trial_v1']::text[]
     or array_position(p_capabilities, null) is not null
     or cardinality(p_capabilities) > 1 then
    raise exception 'invalid ranked client capabilities' using errcode = '22023';
  end if;
  if 'rune_trial_v1' = any(p_capabilities) and p_protocol_version < 2 then
    raise exception 'Rune Trial capability requires protocol v2' using errcode = '22023';
  end if;

  v_result := public.enqueue_ranked_player(p_player);
  -- enqueue_ranked_player holds the profile lock through this transaction.
  -- Read the permanent tier afterwards so a promotion that won the lock first
  -- cannot be overwritten by a stale pre-lock snapshot.
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

-- Reuse the proven lifecycle RPC rather than fork its locks. The nested start
-- and this metadata update commit as one database transaction, so a Trial is
-- never observable in a half-created standard state.
create function public.start_ranked_match_v2(
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
  p_p2_auto_rune text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_started jsonb;
  v_match public.matches%rowtype;
  v_match_id uuid;
  v_rows integer;
  v_expected_queue_rows integer;
  v_current_protocol smallint;
  v_current_pool_tier text;
begin
  if p_protocol_version not in (1, 2)
     or p_pool_tier not in ('stone', 'bone', 'ivory')
     or p_format not in ('standard', 'rune_trial') then
    raise exception 'invalid ranked protocol metadata' using errcode = '22023';
  end if;

  if p_format = 'standard' then
    if p_trial_offer is not null or p_selection_deadline is not null
       or p_p1_auto_rune is not null or p_p2_auto_rune is not null then
      raise exception 'standard match carries Trial metadata' using errcode = '22023';
    end if;
  else
    if p_protocol_version <> 2 or p_pool_tier <> 'ivory' or p_modifier <> 'classic'
       or p_opening_col is not null or p_opening_die is not null
       or p_after_turn is not null or p_after_next_die is not null
       or p_trial_offer is null or cardinality(p_trial_offer) <> 3
       or not p_trial_offer <@ array['fate','nudge','ward','sunder','pilfer','anvil']::text[]
       or (select count(distinct rune) from unnest(p_trial_offer) rune) <> 3
       or p_p1_auto_rune is null or not (p_p1_auto_rune = any(p_trial_offer))
       or p_p2_auto_rune is null or not (p_p2_auto_rune = any(p_trial_offer))
       or p_selection_deadline is null
       or p_selection_deadline <= clock_timestamp()
       or p_selection_deadline > clock_timestamp() + interval '2 minutes' then
      raise exception 'invalid Rune Trial start metadata' using errcode = '22023';
    end if;
  end if;

  if p_p1 = p_p2 or p_requester not in (p_p1, p_p2) then
    raise exception 'invalid ranked participants' using errcode = '22023';
  end if;

  -- Matchmaking reads candidates optimistically, but a second tab may leave
  -- and re-enqueue with older capabilities before this transaction starts.
  -- Take the legacy lifecycle's profile-then-queue lock order, derive the
  -- currently claimed shared metadata under those locks, and reject a stale
  -- draw before start_ranked_match can consume the rows.
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
         case when bool_and(
           protocol_version = 2 and 'rune_trial_v1' = any(capabilities)
         ) then 2 else 1 end::smallint,
         case min(case pool_tier
           when 'stone' then 0 when 'bone' then 1 when 'ivory' then 2
         end)
           when 0 then 'stone' when 1 then 'bone' when 2 then 'ivory'
         end
    into v_rows, v_current_protocol, v_current_pool_tier
    from (
      select protocol_version, capabilities, pool_tier
        from public.matchmaking_queue
       where player_id = p_requester
          or player_id = p_queued_opponent
       order by player_id
       for update
    ) claims;
  if v_rows <> v_expected_queue_rows then
    raise exception 'ranked queue claim is no longer available' using errcode = 'P0001';
  end if;
  if p_protocol_version is distinct from v_current_protocol
     or p_pool_tier is distinct from v_current_pool_tier then
    raise exception 'ranked queue metadata changed before match start' using errcode = 'P0001';
  end if;

  v_started := public.start_ranked_match(
    p_requester, p_p1, p_p2, p_seed, p_next_die, p_modifier,
    p_season_id, p_queued_opponent, p_opening_col, p_opening_die,
    p_after_turn, p_after_next_die
  );
  v_match_id := (v_started->'match'->>'id')::uuid;

  if coalesce((v_started->>'created')::boolean, false) then
    update public.matches
       set format = p_format,
           protocol_version = p_protocol_version,
           rune_rules_version = case when p_format = 'rune_trial' then 1 else null end,
           pool_tier = p_pool_tier,
           phase = case when p_format = 'rune_trial' then 'selection' else 'playing' end,
           trial_offer = p_trial_offer,
           selection_deadline = p_selection_deadline,
           last_move_at = clock_timestamp()
     where id = v_match_id
     returning * into strict v_match;

    if p_format = 'rune_trial' then
      insert into private.rune_trial_choices (
        match_id, p1_auto_rune, p2_auto_rune
      ) values (
        v_match_id, p_p1_auto_rune, p_p2_auto_rune
      );
    end if;
    return jsonb_build_object('created', true, 'match', to_jsonb(v_match));
  end if;

  select * into strict v_match from public.matches where id = v_match_id;
  return jsonb_build_object('created', false, 'match', to_jsonb(v_match));
end;
$function$;

revoke execute on function public.start_ranked_match_v2(
  uuid, uuid, uuid, text, smallint, text, smallint,
  uuid, smallint, smallint, smallint, smallint,
  smallint, text, text, text[], timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.start_ranked_match_v2(
  uuid, uuid, uuid, text, smallint, text, smallint,
  uuid, smallint, smallint, smallint, smallint,
  smallint, text, text, text[], timestamptz, text, text
) to service_role;

-- Caller holds/obtains the match lock first. Missing choices become their
-- precomputed deterministic fallbacks only after the deadline, when forced by
-- a terminal settlement, or immediately for a bot seat (which has no client
-- that can commit a private choice of its own).
create function private.finalize_rune_trial_locked(
  p_match_id uuid,
  p_force boolean default false
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_choice private.rune_trial_choices%rowtype;
  v_p1_bot boolean;
  v_p2_bot boolean;
begin
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;
  if v_match.format <> 'rune_trial' then
    raise exception 'match is not a Rune Trial' using errcode = '22023';
  end if;
  if v_match.phase <> 'selection' then return v_match; end if;

  select * into strict v_choice
    from private.rune_trial_choices
   where match_id = p_match_id
   for update;
  select is_bot into strict v_p1_bot from public.profiles where id = v_match.p1;
  select is_bot into strict v_p2_bot from public.profiles where id = v_match.p2;

  if p_force or v_match.selection_deadline <= clock_timestamp() or v_p1_bot then
    v_choice.p1_choice := coalesce(v_choice.p1_choice, v_choice.p1_auto_rune);
  end if;
  if p_force or v_match.selection_deadline <= clock_timestamp() or v_p2_bot then
    v_choice.p2_choice := coalesce(v_choice.p2_choice, v_choice.p2_auto_rune);
  end if;

  update private.rune_trial_choices
     set p1_choice = v_choice.p1_choice,
         p2_choice = v_choice.p2_choice,
         updated_at = clock_timestamp()
   where match_id = p_match_id;

  if v_choice.p1_choice is not null and v_choice.p2_choice is not null then
    update public.matches
       set phase = 'playing',
           p1_rune = v_choice.p1_choice,
           p2_rune = v_choice.p2_choice,
           selection_deadline = null,
           selection_version = selection_version + 1,
           last_move_at = clock_timestamp()
     where id = p_match_id
     returning * into strict v_match;
  else
    select * into strict v_match from public.matches where id = p_match_id;
  end if;
  return v_match;
end;
$function$;

revoke all on function private.finalize_rune_trial_locked(uuid, boolean)
  from public, anon, authenticated, service_role;

create function private.rune_trial_payload(p_match_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_choice private.rune_trial_choices%rowtype;
  v_yours text;
  v_opponent_committed boolean;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;
  if p_actor not in (v_match.p1, v_match.p2) then
    raise exception 'actor is not a match participant' using errcode = '42501';
  end if;
  if v_match.format <> 'rune_trial' then
    return jsonb_build_object('match', to_jsonb(v_match));
  end if;

  select * into strict v_choice
    from private.rune_trial_choices
   where match_id = p_match_id;
  if p_actor = v_match.p1 then
    v_yours := v_choice.p1_choice;
    v_opponent_committed := v_choice.p2_choice is not null;
  else
    v_yours := v_choice.p2_choice;
    v_opponent_committed := v_choice.p1_choice is not null;
  end if;

  return jsonb_build_object(
    'match', to_jsonb(v_match),
    'trial', jsonb_build_object(
      'offer', to_jsonb(v_match.trial_offer),
      'phase', v_match.phase,
      'deadline', to_jsonb(v_match.selection_deadline),
      'your_choice', v_yours,
      'opponent_committed', v_opponent_committed
    )
  );
end;
$function$;

revoke all on function private.rune_trial_payload(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.rune_trial_state(p_match_id uuid, p_actor uuid)
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
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;
  if p_actor not in (v_match.p1, v_match.p2) then
    raise exception 'actor is not a match participant' using errcode = '42501';
  end if;
  if v_match.format = 'rune_trial' and v_match.phase = 'selection'
     and v_match.selection_deadline <= clock_timestamp() then
    perform private.finalize_rune_trial_locked(p_match_id, true);
  end if;
  return private.rune_trial_payload(p_match_id, p_actor);
end;
$function$;

revoke execute on function public.rune_trial_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rune_trial_state(uuid, uuid)
  to service_role;

create function public.commit_rune_trial_choice(
  p_match_id uuid,
  p_command_id uuid,
  p_actor uuid,
  p_rune_id text,
  p_auto boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_choice private.rune_trial_choices%rowtype;
  v_command private.rune_trial_selection_commands%rowtype;
  v_current text;
  v_response jsonb;
begin
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;

  select * into v_command
    from private.rune_trial_selection_commands
   where match_id = p_match_id and command_id = p_command_id;
  if found then
    if v_command.actor <> p_actor
       or v_command.rune_id is distinct from p_rune_id
       or v_command.auto <> p_auto then
      raise exception 'selection command id was reused with different input'
        using errcode = '22023';
    end if;
    return v_command.response;
  end if;

  if p_actor not in (v_match.p1, v_match.p2) then
    raise exception 'selection actor is not a match participant' using errcode = '42501';
  end if;
  if v_match.status <> 'active' or v_match.format <> 'rune_trial' then
    raise exception 'Rune Trial is not active' using errcode = 'P0001';
  end if;
  if p_auto and p_rune_id is not null then
    raise exception 'automatic selection cannot name a rune' using errcode = '22023';
  end if;
  if not p_auto and (p_rune_id is null or not (p_rune_id = any(v_match.trial_offer))) then
    raise exception 'rune is not in the Trial offer' using errcode = '22023';
  end if;

  if v_match.phase = 'selection' then
    select * into strict v_choice
      from private.rune_trial_choices
     where match_id = p_match_id
     for update;

    if v_match.selection_deadline <= clock_timestamp() then
      v_match := private.finalize_rune_trial_locked(p_match_id, true);
    elsif p_auto then
      raise exception 'selection deadline has not elapsed' using errcode = 'P0001';
    else
      v_current := case when p_actor = v_match.p1
        then v_choice.p1_choice else v_choice.p2_choice end;
      if v_current is not null and v_current <> p_rune_id then
        raise exception 'Rune Trial choice is already committed' using errcode = '22023';
      end if;
      if v_current is null then
        update private.rune_trial_choices
           set p1_choice = case when p_actor = v_match.p1 then p_rune_id else p1_choice end,
               p2_choice = case when p_actor = v_match.p2 then p_rune_id else p2_choice end,
               updated_at = clock_timestamp()
         where match_id = p_match_id;
        update public.matches
           set selection_version = selection_version + 1
         where id = p_match_id;
      end if;
      v_match := private.finalize_rune_trial_locked(p_match_id, false);
    end if;
  end if;

  v_response := private.rune_trial_payload(p_match_id, p_actor);
  insert into private.rune_trial_selection_commands (
    match_id, command_id, actor, rune_id, auto, response
  ) values (
    p_match_id, p_command_id, p_actor, p_rune_id, p_auto, v_response
  );
  return v_response;
end;
$function$;

revoke execute on function public.commit_rune_trial_choice(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.commit_rune_trial_choice(uuid, uuid, uuid, text, boolean)
  to service_role;

-- Extend the existing single settlement boundary. The reviewed private
-- implementation still performs match + ladder + profile-rating writes; this
-- wrapper adds monotonic pool progression and the one-time Trial reward inside
-- that same transaction and lock order.
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

  -- A resignation, timeout, account deletion, or cleanup can settle before
  -- both selection requests arrive. Force the precomputed choices first so
  -- the winner can never be denied their deterministic reward.
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

create function public.match_action_result(
  p_match_id uuid,
  p_command_id uuid,
  p_actor uuid,
  p_auto boolean,
  p_expected_action_version integer,
  p_requested_action jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_command private.match_action_commands%rowtype;
begin
  select * into v_command
    from private.match_action_commands
   where match_id = p_match_id and command_id = p_command_id;
  if not found then return null; end if;
  if v_command.actor <> p_actor
     or v_command.auto <> p_auto
     or v_command.expected_action_version <> p_expected_action_version
     or v_command.requested_action is distinct from p_requested_action then
    raise exception 'action command id was reused with different input'
      using errcode = '22023';
  end if;
  return v_command.response;
end;
$function$;

revoke execute on function public.match_action_result(
  uuid, uuid, uuid, boolean, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.match_action_result(
  uuid, uuid, uuid, boolean, integer, jsonb
) to service_role;

create function public.commit_match_action(
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
    if p_expected_last_move_at is distinct from v_match.last_move_at
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
    update public.matches
       set action_version = v_action_count,
           pending_aim = v_pending_aim,
           last_move_at = clock_timestamp(),
           turn = p_next_turn,
           next_die = p_next_die
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

create function private.purge_expired_rune_trial_commands(
  p_cutoff timestamptz,
  p_limit integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_selection_deleted integer := 0;
  v_action_deleted integer := 0;
begin
  if p_cutoff is null or p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'invalid Rune Trial command-retention boundary'
      using errcode = '22023';
  end if;

  with expired as materialized (
    select command.match_id, command.command_id
      from private.rune_trial_selection_commands command
     where command.created_at < p_cutoff
       and coalesce((
         select match.status <> 'active' and match.finished_at < p_cutoff
           from public.matches match where match.id = command.match_id
       ), false)
     order by command.created_at, command.match_id, command.command_id
     limit p_limit
  ), deleted as (
    delete from private.rune_trial_selection_commands command
     using expired
     where command.match_id = expired.match_id
       and command.command_id = expired.command_id
    returning 1
  )
  select count(*)::integer into v_selection_deleted from deleted;

  with expired as materialized (
    select command.match_id, command.command_id
      from private.match_action_commands command
     where command.created_at < p_cutoff
       and coalesce((
         select match.status <> 'active' and match.finished_at < p_cutoff
           from public.matches match where match.id = command.match_id
       ), false)
     order by command.created_at, command.match_id, command.command_id
     limit greatest(0, p_limit - v_selection_deleted)
  ), deleted as (
    delete from private.match_action_commands command
     using expired
     where command.match_id = expired.match_id
       and command.command_id = expired.command_id
    returning 1
  )
  select count(*)::integer into v_action_deleted from deleted;
  return v_selection_deleted + v_action_deleted;
end;
$function$;

revoke all on function private.purge_expired_rune_trial_commands(timestamptz, integer)
  from public, anon, authenticated, service_role;

select cron.schedule(
  'purge-expired-rune-trial-commands',
  '7 * * * *',
  $cron$
    select private.purge_expired_rune_trial_commands(
      clock_timestamp() - interval '7 days',
      5000
    );
  $cron$
);

commit;
