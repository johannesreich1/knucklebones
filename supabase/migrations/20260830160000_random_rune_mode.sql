-- RANDOM equipment keeps one concrete owned fallback for installed clients
-- that know only profiles.equipped_rune, while each new ordinary ranked match
-- snapshots a seed-derived choice from the complete current collection.
-- Rune Trial and the SILVER threshold retain their existing boundaries.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

alter table public.profiles
  add column random_rune_mode boolean not null default false;

alter table public.profiles
  add constraint profiles_random_rune_mode_has_fallback
  check (not random_rune_mode or equipped_rune is not null) not valid;
alter table public.profiles
  validate constraint profiles_random_rune_mode_has_fallback;

comment on column public.profiles.random_rune_mode is
  'When true, ordinary ranked from SILVER snapshots a seed-derived random rune from the player collection. equipped_rune remains a concrete owned fallback for older clients. Rune Trial ignores both profile fields.';

-- RANDOM is intentionally not a directly writable profile column. Installed
-- clients retain their narrow equipped_rune grant for fixed/clear writes; the
-- v2 client must use set_rune_equipment so changing a RANDOM fallback cannot
-- be confused with one of those legacy PATCHes.
revoke update (random_rune_mode) on public.profiles
  from public, anon, authenticated;

-- Compatibility for the already-deployed client: a PATCH that writes only
-- equipped_rune means "use this fixed rune" (or clear it), so it must leave
-- RANDOM instead of tripping the new fallback constraint. That legacy path
-- executes as authenticated. The ownership foreign key can also SET NULL as
-- the table owner when an equipped rune is removed; that transition must clear
-- RANDOM too. The SECURITY DEFINER equipment RPC executes its complete v2
-- write as the function owner, and preserves RANDOM whenever its fallback stays
-- non-null. A forged fallback-free shape is still left for the CHECK to reject.
create function private.normalize_rune_equipment_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.random_rune_mode
     and (current_user = 'authenticated' or new.equipped_rune is null) then
    new.random_rune_mode := false;
  end if;
  return new;
end;
$function$;

comment on function private.normalize_rune_equipment_update() is
  'Compatibility trigger: authenticated direct equipped_rune writes and ownership SET NULL clear RANDOM; owner-executed equipment RPC preserves non-null one-statement v2 writes.';
revoke all on function private.normalize_rune_equipment_update()
  from public, anon, authenticated, service_role;

create trigger profiles_normalize_rune_equipment_update
before update of equipped_rune, random_rune_mode on public.profiles
for each row execute function private.normalize_rune_equipment_update();

-- One Data API call owns the complete v2 equipment transition. SECURITY
-- DEFINER is deliberate: authenticated has no direct random_rune_mode grant,
-- so the exposed function must perform that one privileged write. There is no
-- player-id parameter; auth.uid() is the only row it can touch. The trigger
-- recognizes the function-owner execution context and leaves this single
-- complete UPDATE intact, so SQL readers and logical decoding observe only the
-- requested state and RANDOM/ward -> RANDOM/nudge is no longer ambiguous.
create function public.set_rune_equipment(
  p_equipped_rune text,
  p_random_rune_mode boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_player uuid := auth.uid();
  v_result jsonb;
begin
  if v_player is null then
    raise exception 'authenticated player is required' using errcode = '42501';
  end if;
  if p_random_rune_mode is null then
    raise exception 'random rune mode is required' using errcode = '22023';
  end if;
  if p_random_rune_mode and p_equipped_rune is null then
    raise exception 'random rune mode requires an equipped fallback'
      using errcode = '22023';
  end if;

  update public.profiles as profile
     set equipped_rune = p_equipped_rune,
         random_rune_mode = p_random_rune_mode
   where profile.id = v_player
   returning jsonb_build_object(
               'equipped_rune', profile.equipped_rune,
               'random_rune_mode', profile.random_rune_mode
             )
        into v_result;
  if not found then
    raise exception 'authenticated profile is missing' using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

comment on function public.set_rune_equipment(text, boolean) is
  'Authenticated-only atomic fixed, RANDOM, or empty equipment write for auth.uid(); RANDOM keeps an owned fallback and direct legacy equipped_rune writes remain fixed.';
revoke all on function public.set_rune_equipment(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_rune_equipment(text, boolean)
  to authenticated;

-- The match seed is cryptographically fresh, but the selection itself is
-- deterministic. Retries and audits therefore see one answer, while different
-- matches sample the whole owned set. The existing (player_id, rune_id)
-- primary key covers the filtered inventory read.
create function private.random_owned_rune_for_match(
  p_player uuid,
  p_seed text
)
returns text
language sql
stable
strict
security invoker
set search_path = ''
as $function$
  select owned.rune_id
    from public.player_runes owned
   where owned.player_id = p_player
   order by md5(
     p_seed || ':' || p_player::text || ':random-equipped-v1:' || owned.rune_id
   ), owned.rune_id
   limit 1;
$function$;

comment on function private.random_owned_rune_for_match(uuid, text) is
  'Deterministic per-match choice from the participant current owned inventory; returns NULL for an empty inventory.';
revoke all on function private.random_owned_rune_for_match(uuid, text)
  from public, anon, authenticated, service_role;

-- Keep the deployed Edge Function contract byte-for-byte compatible: only the
-- database implementation changes. v3 already holds both profile and queue
-- locks through the snapshot, so ownership, equipment mode, and immutable
-- match runes remain one transaction.
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
           p1_rune = case when p1_profile.rating >= 1260 then
             case when p1_profile.random_rune_mode
               then private.random_owned_rune_for_match(p1_profile.id, p_seed)
               else p1_profile.equipped_rune
             end
             else null end,
           p2_rune = case when p2_profile.rating >= 1260 then
             case when p2_profile.random_rune_mode
               then private.random_owned_rune_for_match(p2_profile.id, p_seed)
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

commit;
