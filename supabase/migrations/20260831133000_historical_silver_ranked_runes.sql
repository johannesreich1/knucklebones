-- Reaching SILVER once permanently unlocks the equipped-rune seat. Any
-- qualifying season peak records that achievement across demotion and
-- rollover; the mutable profile rating is not historical evidence. The
-- deployed Edge Function contract does not change.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

comment on column public.profiles.equipped_rune is
  'The one collected rune carried into ordinary ranked after SILVER has been reached once. NULL means nothing equipped, which is a deliberate choice and not an error. Rune Trial ignores this and never overwrites it.';
comment on column public.profiles.random_rune_mode is
  'When true, ordinary ranked after SILVER has been reached once snapshots a seed-derived random rune from the player collection. equipped_rune remains a concrete owned fallback for older clients. Rune Trial ignores both profile fields.';

create or replace function public.start_ranked_match_v3(
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
           p1_rune = case when exists (
             select 1
               from public.season_ratings p1_rating
              where p1_rating.player = p1_profile.id
                and p1_rating.peak >= 1260
           ) then
             case when p1_profile.random_rune_mode
               then coalesce(
                 private.random_owned_rune_for_match(p1_profile.id, p_seed),
                 p1_profile.equipped_rune
               )
               else p1_profile.equipped_rune
             end
             else null end,
           p2_rune = case when exists (
             select 1
               from public.season_ratings p2_rating
              where p2_rating.player = p2_profile.id
                and p2_rating.peak >= 1260
           ) then
             case when p2_profile.random_rune_mode
               then coalesce(
                 private.random_owned_rune_for_match(p2_profile.id, p_seed),
                 p2_profile.equipped_rune
               )
               else p2_profile.equipped_rune
             end
             else null end,
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

-- The progression table was deployed one migration earlier with live
-- equipment/current-points flags. Converge those rows in the same atomic
-- rollout that changes ordinary-ranked eligibility.

alter table public.ranked_progression_events
  drop constraint ranked_progression_events_rune_live_before_check,
  drop constraint ranked_progression_events_rune_live_after_check;

-- Old rows can contain true -> false demotions or false -> false snapshots for
-- an unequipped player who had already reached SILVER. Any old true value is
-- itself durable proof; season peaks supply the authority for every other row.
-- Their original peak-before timestamp is unrecoverable, so every existing row
-- for an unlocked player becomes true -> true. This deliberately suppresses a
-- stale or duplicate unlock screen; new settlements retain false -> true.
with historical_unlocks as materialized (
  select event.player_id,
         bool_or(event.rune_seat_active_before
                 or event.rune_seat_active_after)
         or exists (
           select 1
             from public.season_ratings rating
            where rating.player = event.player_id
              and rating.peak >= 1260
         ) as unlocked
    from public.ranked_progression_events event
   group by event.player_id
)
update public.ranked_progression_events event
   set rune_seat_active_before = unlock.unlocked,
       rune_seat_active_after = unlock.unlocked
  from historical_unlocks unlock
 where unlock.player_id = event.player_id
   and (event.rune_seat_active_before is distinct from unlock.unlocked
        or event.rune_seat_active_after is distinct from unlock.unlocked);

alter table public.ranked_progression_events
  add constraint ranked_progression_events_rune_unlock_monotonic_check
    check (not rune_seat_active_before or rune_seat_active_after) not valid;
alter table public.ranked_progression_events
  validate constraint ranked_progression_events_rune_unlock_monotonic_check;

comment on column public.ranked_progression_events.rune_seat_active_before is
  'Whether the player had ever reached SILVER before settlement; the legacy active name records a permanent unlock, independent of current points or equipment.';
comment on column public.ranked_progression_events.rune_seat_active_after is
  'Whether the player has ever reached SILVER after settlement; once true this permanent unlock never becomes false.';

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
  v_p1_rune_unlocked_before boolean;
  v_p2_rune_unlocked_before boolean;
  v_p1_rune_unlocked_after boolean;
  v_p2_rune_unlocked_after boolean;
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
  /* The equipment seat is an all-season achievement. Snapshot the durable
     fact before the current row changes. The authoritative payload peak also
     covers the current row being created by this settlement; mutable profile
     rating is deliberately not historical evidence. */
  v_p1_rune_unlocked_before := (p_expected_p1->>'peak')::integer >= 1260
    or exists (
      select 1 from public.season_ratings rating
       where rating.player = v_match.p1 and rating.peak >= 1260
    );
  v_p2_rune_unlocked_before := (p_expected_p2->>'peak')::integer >= 1260
    or exists (
      select 1 from public.season_ratings rating
       where rating.player = v_match.p2 and rating.peak >= 1260
    );
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
  v_p1_rune_unlocked_after := v_p1_rune_unlocked_before
    or (p_next_p1->>'peak')::integer >= 1260
    or exists (
      select 1 from public.season_ratings rating
       where rating.player = v_match.p1 and rating.peak >= 1260
    );
  v_p2_rune_unlocked_after := v_p2_rune_unlocked_before
    or (p_next_p2->>'peak')::integer >= 1260
    or exists (
      select 1 from public.season_ratings rating
       where rating.player = v_match.p2 and rating.peak >= 1260
    );

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
      v_p1_rune_unlocked_before,
      v_p1_rune_unlocked_after
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
      v_p2_rune_unlocked_before,
      v_p2_rune_unlocked_after
    ) on conflict (source_match_id, player_id) do nothing;
  end if;
  return v_result;
end;
$function$;

revoke execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) to service_role;

commit;
