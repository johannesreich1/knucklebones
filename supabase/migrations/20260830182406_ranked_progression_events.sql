-- Durable, owner-only facts for the ranked result's group transition deck.
-- Points alone cannot reconstruct a historical NEON crossing: NEON is the
-- board's positional top 1%, so settlement snapshots its apex flag on both
-- sides of the same atomic ladder write. Permanent pool and equipped-seat
-- facts travel with it so a client never guesses from a later profile read.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

create table public.ranked_progression_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  source_match_id uuid references public.matches(id) on delete set null,
  season_id smallint not null references public.seasons(id) on delete cascade,
  points_before integer not null,
  points_after integer not null,
  apex_before boolean not null,
  apex_after boolean not null,
  pool_tier_before text not null,
  pool_tier_after text not null,
  equipped_rune_before text,
  equipped_rune_after text,
  random_rune_mode_before boolean not null,
  random_rune_mode_after boolean not null,
  rune_seat_active_before boolean not null,
  rune_seat_active_after boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  seen_at timestamptz,
  constraint ranked_progression_events_match_player_key
    unique (source_match_id, player_id),
  constraint ranked_progression_events_points_check
    check (points_before >= 0 and points_after >= 0),
  constraint ranked_progression_events_pool_before_check
    check (pool_tier_before in ('stone', 'bone', 'ivory')),
  constraint ranked_progression_events_pool_after_check
    check (pool_tier_after in ('stone', 'bone', 'ivory')),
  constraint ranked_progression_events_equipped_before_check
    check (equipped_rune_before is null
      or equipped_rune_before in ('fate','nudge','ward','sunder','pilfer','anvil')),
  constraint ranked_progression_events_equipped_after_check
    check (equipped_rune_after is null
      or equipped_rune_after in ('fate','nudge','ward','sunder','pilfer','anvil')),
  constraint ranked_progression_events_random_before_check
    check (not random_rune_mode_before or equipped_rune_before is not null),
  constraint ranked_progression_events_random_after_check
    check (not random_rune_mode_after or equipped_rune_after is not null),
  constraint ranked_progression_events_rune_live_before_check
    check (rune_seat_active_before =
      (equipped_rune_before is not null and points_before >= 1260)),
  constraint ranked_progression_events_rune_live_after_check
    check (rune_seat_active_after =
      (equipped_rune_after is not null and points_after >= 1260)),
  constraint ranked_progression_events_seen_check
    check (seen_at is null or seen_at >= created_at)
);

create index ranked_progression_events_player_created_idx
  on public.ranked_progression_events (player_id, created_at, id);
create index ranked_progression_events_season_idx
  on public.ranked_progression_events (season_id);

alter table public.ranked_progression_events enable row level security;
create policy ranked_progression_events_select_own
  on public.ranked_progression_events
  for select to authenticated
  using (player_id = (select auth.uid()));

revoke all on table public.ranked_progression_events
  from public, anon, authenticated, service_role;
grant select on table public.ranked_progression_events to authenticated;

comment on table public.ranked_progression_events is
  'One owner-only before/after snapshot per settled human participant; drives mandatory ranked group transition presentation.';
comment on column public.ranked_progression_events.apex_before is
  'Historical private.ladder_board apex result immediately before this settlement; required because NEON is positional.';
comment on column public.ranked_progression_events.seen_at is
  'Stamped only by acknowledge_ranked_progression after the player reaches Continue.';

create function public.acknowledge_ranked_progression(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player uuid := (select auth.uid());
begin
  if v_player is null then
    raise exception 'ranked progression acknowledgement requires authentication'
      using errcode = '42501';
  end if;
  update public.ranked_progression_events
     set seen_at = clock_timestamp()
   where id = p_event_id
     and player_id = v_player
     and seen_at is null;
  return found;
end;
$function$;

comment on function public.acknowledge_ranked_progression(uuid) is
  'Authenticated owner-only acknowledgement after the mandatory progression deck reaches Continue.';
revoke execute on function public.acknowledge_ranked_progression(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_ranked_progression(uuid)
  to authenticated;

-- Preserve the existing eleven-argument settlement boundary and response.
-- The event rows are a side effect inside the same transaction; no deployed
-- Edge Function needs a new field or a new invocation signature.
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
  v_season smallint;
  v_p1_apex_before boolean;
  v_p2_apex_before boolean;
  v_p1_apex_after boolean;
  v_p2_apex_after boolean;
  v_p1_pool_before text;
  v_p2_pool_before text;
  v_p1_pool_after text;
  v_p2_pool_after text;
  v_p1_equipped_before text;
  v_p2_equipped_before text;
  v_p1_equipped_after text;
  v_p2_equipped_after text;
  v_p1_random_before boolean;
  v_p2_random_before boolean;
  v_p1_random_after boolean;
  v_p2_random_after boolean;
  v_p1_is_bot boolean;
  v_p2_is_bot boolean;
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

  v_season := coalesce(v_match.season_id, 1);
  select profile.ranked_pool_tier, profile.equipped_rune,
         profile.random_rune_mode, profile.is_bot
    into strict v_p1_pool_before, v_p1_equipped_before,
                v_p1_random_before, v_p1_is_bot
    from public.profiles profile
   where profile.id = v_match.p1;
  select profile.ranked_pool_tier, profile.equipped_rune,
         profile.random_rune_mode, profile.is_bot
    into strict v_p2_pool_before, v_p2_equipped_before,
                v_p2_random_before, v_p2_is_bot
    from public.profiles profile
   where profile.id = v_match.p2;
  v_p1_apex_before := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p1
  ), false);
  v_p2_apex_before := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p2
  ), false);

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
   where id = v_match.p1
   returning ranked_pool_tier into strict v_p1_pool_after;
  update public.profiles
     set ranked_pool_tier = case
       when ranked_pool_tier = 'ivory' or v_p2_tier = 'ivory' then 'ivory'
       when ranked_pool_tier = 'bone' or v_p2_tier = 'bone' then 'bone'
       else 'stone'
     end
   where id = v_match.p2
   returning ranked_pool_tier into strict v_p2_pool_after;

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

  select profile.equipped_rune, profile.random_rune_mode
    into strict v_p1_equipped_after, v_p1_random_after
    from public.profiles profile
   where profile.id = v_match.p1;
  select profile.equipped_rune, profile.random_rune_mode
    into strict v_p2_equipped_after, v_p2_random_after
    from public.profiles profile
   where profile.id = v_match.p2;
  v_p1_apex_after := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p1
  ), false);
  v_p2_apex_after := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p2
  ), false);

  if not v_p1_is_bot then
    insert into public.ranked_progression_events (
      player_id, source_match_id, season_id,
      points_before, points_after, apex_before, apex_after,
      pool_tier_before, pool_tier_after,
      equipped_rune_before, equipped_rune_after,
      random_rune_mode_before, random_rune_mode_after,
      rune_seat_active_before, rune_seat_active_after
    ) values (
      v_match.p1, p_match_id, v_season,
      (p_expected_p1->>'points')::integer, (p_next_p1->>'points')::integer,
      v_p1_apex_before, v_p1_apex_after,
      v_p1_pool_before, v_p1_pool_after,
      v_p1_equipped_before, v_p1_equipped_after,
      v_p1_random_before, v_p1_random_after,
      v_p1_equipped_before is not null and (p_expected_p1->>'points')::integer >= 1260,
      v_p1_equipped_after is not null and (p_next_p1->>'points')::integer >= 1260
    ) on conflict (source_match_id, player_id) do nothing;
  end if;
  if not v_p2_is_bot then
    insert into public.ranked_progression_events (
      player_id, source_match_id, season_id,
      points_before, points_after, apex_before, apex_after,
      pool_tier_before, pool_tier_after,
      equipped_rune_before, equipped_rune_after,
      random_rune_mode_before, random_rune_mode_after,
      rune_seat_active_before, rune_seat_active_after
    ) values (
      v_match.p2, p_match_id, v_season,
      (p_expected_p2->>'points')::integer, (p_next_p2->>'points')::integer,
      v_p2_apex_before, v_p2_apex_after,
      v_p2_pool_before, v_p2_pool_after,
      v_p2_equipped_before, v_p2_equipped_after,
      v_p2_random_before, v_p2_random_after,
      v_p2_equipped_before is not null and (p_expected_p2->>'points')::integer >= 1260,
      v_p2_equipped_after is not null and (p_next_p2->>'points')::integer >= 1260
    ) on conflict (source_match_id, player_id) do nothing;
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

commit;
